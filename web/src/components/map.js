import * as d3 from 'npm:d3';
import * as d3h from 'npm:d3-hexbin';
import * as d3t from 'npm:d3-tile';
import * as fmt from './formatters.js';
import _ from 'npm:lodash';
import { MAPBOX_TOKEN } from '../token.js';

function tileURL(x, y, z) {
  // return `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/${z}/${x}/${y}${devicePixelRatio > 1 ? "@2x" : ""}?access_token=${MAPBOX_TOKEN}`
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/${z}/${x}/${y}${devicePixelRatio > 1 ? '@2x' : ''}?access_token=${MAPBOX_TOKEN}`;
}

function speedColor(speeds) {
  const maxSpeed = d3.max(speeds);

  const colorScale = d3
    .scaleQuantile()
    .domain(speeds.filter(s => s > 11))
    .range(['#ff0', '#cf0', '#9f0', '#6f0', '#3f0', '#0f0']);

  return function (speed) {
    return speed > 11 ? colorScale(speed) : '#900';
  };
}

export function createColorizer(data, baseHue) {
  const speeds = data.map(d => d.speed).filter(s => s != null);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);

  return speed => {
    if (speed == null) return `hsl(${baseHue}, 70%, 50%)`;
    if (speed < 11) return `hsl(${baseHue}, 40%, 30%)`;

    // Normalize speed to 0-1 range
    const normalized = speeds.length > 1 ? (speed - minSpeed) / (maxSpeed - minSpeed) : 0.5;

    const lightness = 30 + normalized * 40; // Range: 30% to 70%
    const saturation = 70 + normalized * 20; // Range: 70% to 90%

    return `hsl(${baseHue}, ${saturation}%, ${lightness}%)`;
  };
};

// Find the fastest 1000m segment in the data
export function findFastest1kSegment(data) {
  if (data.length < 2) return null;

  let bestSegment = null;
  let bestDuration = Infinity;

  // For each reading, find the segment that covers approximately 1000m
  for (let i = 0; i < data.length; i++) {
    const startReading = data[i];
    let cumulativeDistance = 0;

    // Get starting distance if available
    let startDistance = 0;
    if (startReading.distance !== undefined) {
      startDistance = startReading.distance;
    }

    // Look forward to find the 1000m segment
    for (let j = i + 1; j < data.length; j++) {
      const currentReading = data[j];

      cumulativeDistance = currentReading.distance - startDistance;

      // Check if we've reached approximately 1000m
      if (cumulativeDistance >= 1000) {
        const duration = currentReading.tsi - startReading.tsi;

        // If this is faster than our current best, update
        if (duration < bestDuration) {
          bestDuration = duration;
          bestSegment = {
            start: i,
            end: j,
            duration: duration,
            distance: cumulativeDistance,
            startTime: startReading.ts,
            endTime: currentReading.ts,
            startReading: startReading,
            endReading: currentReading,
          };
        }

        // Break inner loop as we've found our segment for this start point
        break;
      }
    }
  }

  return bestSegment;
}

export function renderRun(width, datas, callouts = [], opts = { fastestSegments: null }) {
  const colorizers = opts.colorizers || datas.map(data => speedColor(data.map(d => d.speed)));
  const height = width * 0.5;
  const svg = d3.create('svg').attr('viewBox', [0, 0, width, height]);

  const fastestSegments = opts.fastestSegments;

  // Add defs for arrowhead marker
  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 1)
    .attr('refY', 3)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M1,0 L1,6 L10,3 z')
    .attr('fill', '#333');

  const projection = d3
    .geoMercator()
    .scale(1 / (2 * Math.PI))
    .translate([0, 0]);
  const tile = d3t
    .tile()
    .extent([
      [0, 0],
      [width, height],
    ])
    .tileSize(512);
  const zoom = d3
    .zoom()
    .scaleExtent([1 << 10, 1 << 24])
    .extent([
      [0, 0],
      [width, height],
    ])
    .on('zoom', ({ transform }) => zoomed(transform));
  let image = svg.append('g').attr('pointer-events', 'none').selectAll('image');
  const runG = svg.append('g');
  let dots = runG.selectAll('.run-dot');
  let segments = runG.selectAll('.run-segment');

  // Add callout groups
  const calloutsG = svg.append('g').attr('class', 'callouts');
  let calloutGroups = calloutsG.selectAll('.callout-group');

  let additional;
  if (typeof opts.additionalMarks === 'function') {
    additional = opts.additionalMarks({ d3, svg, width, height });
  }

  svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));

  const fc = {
    type: 'FeatureCollection',
    features: datas.flatMap(data =>
      data.map(d => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [+d.lon, +d.lat] },
      }))
    ),
  };

  const proj0 = d3.geoMercator();
  const pad = 24;
  proj0.fitExtent(
    [
      [pad, pad],
      [width - pad, height - pad],
    ],
    fc
  );
  const k = proj0.scale() * 2 * Math.PI;
  const [tx, ty] = proj0.translate();
  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));

  function zoomed(transform) {
    // Update tiles
    const tiles = tile(transform);
    image = image
      .data(tiles, d => d)
      .join('image')
      .attr('xlink:href', d => tileURL(...d))
      .attr('x', ([x]) => (x + tiles.translate[0]) * tiles.scale)
      .attr('y', ([, y]) => (y + tiles.translate[1]) * tiles.scale)
      .attr('width', tiles.scale)
      .attr('height', tiles.scale);

    // Update projection
    projection.scale(transform.k / (2 * Math.PI)).translate([transform.x, transform.y]);

    // Calculate dot radius based on zoom level
    const zoomLevel = Math.log2(transform.k);
    const dotRadius = Math.max(2, 4 * Math.pow(0.9, zoomLevel - 12));

    // Build per-dataset points (don't filter out-of-bounds here — we need
    // consecutive pairs, and a segment can be valid even if one endpoint is offscreen)
    const datasetProjected = datas.map(data =>
      data.map(d => {
        const p = projection([+d.lon, +d.lat]);
        return p ? { x: p[0], y: p[1], data: d } : null;
      })
    );

    const gapThreshold = dotRadius * 3;

    const segmentData = [];
    datasetProjected.forEach((points, datasetIdx) => {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (!a || !b) continue;

        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist <= gapThreshold) continue;

        // skip if neither endpoint is anywhere near the viewport
        const visible = pt =>
          pt.x >= -50 && pt.x <= width + 50 && pt.y >= -50 && pt.y <= height + 50;
        if (!visible(a) && !visible(b)) continue;

        segmentData.push({
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          color: colorizers[datasetIdx](a.data.speed),
        });
      }
    });

    segments = segments
      .data(segmentData, d => `${d.x1},${d.y1}-${d.x2},${d.y2}`)
      .join(
        enter =>
          enter
            .insert('line', '.run-dot') // keep segments visually below dots
            .attr('class', 'run-segment')
            .attr('stroke-width', 4)
            .attr('opacity', 0.8)
            .style('pointer-events', 'none'),
        update => update,
        exit => exit.remove()
      )
      .attr('x1', d => d.x1)
      .attr('y1', d => d.y1)
      .attr('x2', d => d.x2)
      .attr('y2', d => d.y2)
      .attr('stroke', d => d.color);

    // Project data points with original index info
    const projectedData = datas
      .flatMap((data, i) =>
        data.map((d, idx) => {
          const p = projection([+d.lon, +d.lat]);
          return p && p[0] >= -50 && p[0] <= width + 50 && p[1] >= -50 && p[1] <= height + 50
            ? { x: p[0], y: p[1], data: d, dataset: i, indexInDataset: idx }
            : null;
        })
      )
      .filter(d => d !== null);

    // Render dots
    dots = dots
      .data(projectedData, d => `${d.data.lon}-${d.data.lat}`)
      .join(
        enter =>
          enter
            .append('circle')
            .attr('class', 'run-dot')
            .attr('fill', d => {
              return colorizers[d.dataset](d.data.speed);
            })
            .attr('stroke', d => {
              return colorizers[d.dataset](d.data.speed);
            })
            .attr('stroke-width', 0)
            .attr('opacity', 0.9)
            .style('cursor', 'pointer'),
        update => update,
        exit => exit.remove()
      )
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', dotRadius);

    runG.selectAll('.fastest-segment-line').remove();

    fastestSegments.forEach(fastestSegment => {
      const startProjected = projection([
        +fastestSegment.startReading.lon,
        +fastestSegment.startReading.lat,
      ]);
      const endProjected = projection([
        +fastestSegment.endReading.lon,
        +fastestSegment.endReading.lat,
      ]);

      if (
        startProjected &&
        endProjected &&
        startProjected[0] >= -100 &&
        startProjected[0] <= width + 100 &&
        startProjected[1] >= -100 &&
        startProjected[1] <= height + 100 &&
        endProjected[0] >= -100 &&
        endProjected[0] <= width + 100 &&
        endProjected[1] >= -100 &&
        endProjected[1] <= height + 100
      ) {
        runG
          .append('line')
          .attr('class', 'fastest-segment-line')
          .attr('x1', startProjected[0])
          .attr('y1', startProjected[1])
          .attr('x2', endProjected[0])
          .attr('y2', endProjected[1])
          .attr('stroke', '#ff00ff')
          .attr('stroke-width', 3)
          .attr('stroke-dasharray', '5,5')
          .attr('opacity', 0.8)
          .style('pointer-events', 'none');
      }
    });

    // Add hover behavior to data points
    dots
      .on('mouseenter', function (event, d) {
        // Create tooltip
        const tooltip = d3
          .select('body')
          .append('div')
          .attr('class', 'data-point-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.9)')
          .style('color', 'white')
          .style('padding', '8px 12px')
          .style('border-radius', '4px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .style('max-width', '200px');

        // Format tooltip content
        const content = [
          `Date: ${fmt.date(d.data.ts)}`,
          `Time: ${fmt.time(d.data.ts)}`,
          `Time so far: ${fmt.timeDiff(datas[d.dataset][0].ts, d.data.ts)}`,
          // `Distance So Far: ${(d.data.distance / 1000).toFixed(2)} km`,
          `Speed: ${d.data.speed ? d.data.speed.toFixed(1) : 'N/A'} kph`,
          // `Heart Rate: ${d.data.hr ? d.data.hr : 'unknown'} bpm`,
          // `Nearest Land: ${d.data.distance_to_land ? (d.data.distance_to_land / 1000).toFixed(2) : 'unknown'} km`,
        ];

        tooltip.html(content.join('<br>'));

        // Position tooltip
        const rect = this.getBoundingClientRect();
        const tooltipNode = tooltip.node();
        const tooltipRect = tooltipNode.getBoundingClientRect();

        let left = rect.left + window.pageXOffset + rect.width / 2 - tooltipRect.width / 2;
        let top = rect.top + window.pageYOffset - tooltipRect.height - 10;

        // Keep tooltip on screen
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
          left = window.innerWidth - tooltipRect.width - 10;
        }
        if (top < 10) {
          top = rect.bottom + window.pageYOffset + 10; // Show below point instead
        }

        tooltip.style('left', left + 'px').style('top', top + 'px');

        // Highlight data point
        d3.select(this).attr('stroke-width', 2).attr('opacity', 1);

        // Draw line to nearest land if coordinates are available
        if (d.data.nearest_land_lat && d.data.nearest_land_lon) {
          const landPoint = projection([+d.data.nearest_land_lon, +d.data.nearest_land_lat]);

          if (
            landPoint &&
            landPoint[0] >= -100 &&
            landPoint[0] <= width + 100 &&
            landPoint[1] >= -100 &&
            landPoint[1] <= height + 100
          ) {
            // Add line to nearest land
            runG
              .append('line')
              .attr('class', 'nearest-land-line')
              .attr('x1', d.x)
              .attr('y1', d.y)
              .attr('x2', landPoint[0])
              .attr('y2', landPoint[1])
              .attr('stroke', '#ff6b6b')
              .attr('stroke-width', 2)
              .attr('stroke-dasharray', '5,5')
              .attr('opacity', 0.8)
              .style('pointer-events', 'none');

            // Add small circle at land point
            runG
              .append('circle')
              .attr('class', 'nearest-land-point')
              .attr('cx', landPoint[0])
              .attr('cy', landPoint[1])
              .attr('r', 4)
              .attr('fill', '#ff6b6b')
              .attr('stroke', 'white')
              .attr('stroke-width', 1)
              .attr('opacity', 0.9)
              .style('pointer-events', 'none');
          }
        }
      })
      .on('mouseleave', function () {
        // Remove tooltip
        d3.select('.data-point-tooltip').remove();

        // Remove nearest land line and point
        runG.selectAll('.nearest-land-line').remove();
        runG.selectAll('.nearest-land-point').remove();

        // Reset highlight
        d3.select(this).attr('stroke-width', 0).attr('opacity', 0.9);
      });

    // Project and render callouts
    const projectedCallouts = callouts
      .map(callout => {
        const p = projection([+callout.lon, +callout.lat]);
        if (!p || p[0] < -100 || p[0] > width + 100 || p[1] < -100 || p[1] > height + 100) {
          return null;
        }

        // Calculate offset position for icon (45 degrees up and right)
        const offsetDistance = 80 + Math.max(0, (15 - zoomLevel) * 8);
        const offsetX = p[0] + offsetDistance * Math.cos(-Math.PI / 4);
        const offsetY = p[1] + offsetDistance * Math.sin(-Math.PI / 4);

        return {
          ...callout,
          pointX: p[0],
          pointY: p[1],
          iconX: offsetX,
          iconY: offsetY,
        };
      })
      .filter(d => d !== null);

    calloutGroups = calloutGroups
      .data(projectedCallouts, d => `${d.lat}-${d.lon}`)
      .join(
        enter => {
          const group = enter.append('g').attr('class', 'callout-group').style('cursor', 'pointer');

          // Add arrow path (curved)
          group
            .append('path')
            .attr('class', 'callout-arrow')
            .attr('stroke', '#333')
            .attr('stroke-width', 1.5)
            .attr('fill', 'none')
            .attr('marker-end', 'url(#arrowhead)');

          // Add icon background circle
          group
            .append('circle')
            .attr('class', 'callout-icon-bg')
            .attr('r', 12)
            .attr('fill', 'white')
            .attr('stroke', '#333')
            .attr('stroke-width', 1.5);

          // Add icon text
          group
            .append('text')
            .attr('class', 'callout-icon')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', '16px')
            .attr('fill', '#333')
            .style('pointer-events', 'none');

          // Add invisible hover target
          group
            .append('circle')
            .attr('class', 'callout-hover-target')
            .attr('r', 20)
            .attr('fill', 'transparent');

          return group;
        },
        update => update,
        exit => exit.remove()
      );

    // Update callout positions and content
    calloutGroups.each(function (d) {
      const group = d3.select(this);

      // Calculate curved path from callout icon to data point
      const dx = d.pointX - d.iconX;
      const dy = d.pointY - d.iconY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Create a control point for the curve (perpendicular to the line)
      const curvature = 0.3; // Adjust this to make curve more/less pronounced
      const midX = (d.iconX + d.pointX) / 2;
      const midY = (d.iconY + d.pointY) / 2;
      const perpX = (-dy / distance) * curvature * distance * 0.2;
      const perpY = (dx / distance) * curvature * distance * 0.2;
      const controlX = midX + perpX;
      const controlY = midY + perpY;

      // Start path from edge of icon circle, end just before data point
      const iconRadius = 12;
      const startX = d.iconX + (dx / distance) * iconRadius;
      const startY = d.iconY + (dy / distance) * iconRadius;
      const endX = d.pointX - (dx / distance) * 3; // Stop 3px from point
      const endY = d.pointY - (dy / distance) * 3;

      const pathData = `M${startX},${startY} Q${controlX},${controlY} ${endX},${endY}`;

      // Update arrow path
      group.select('.callout-arrow').attr('d', pathData);

      // Update icon position
      group.select('.callout-icon-bg').attr('cx', d.iconX).attr('cy', d.iconY);

      group.select('.callout-icon').attr('x', d.iconX).attr('y', d.iconY).text(d.icon);

      group.select('.callout-hover-target').attr('cx', d.iconX).attr('cy', d.iconY);
    });

    // Add hover behavior with tooltip
    calloutGroups
      .on('mouseenter', function (event, d) {
        // Create tooltip
        const tooltip = d3
          .select('body')
          .append('div')
          .attr('class', 'callout-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.8)')
          .style('color', 'white')
          .style('padding', '8px 12px')
          .style('border-radius', '4px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .text(d.text);

        // Position tooltip
        const rect = event.target.getBoundingClientRect();
        tooltip
          .style('left', rect.left + window.pageXOffset + 25 + 'px')
          .style('top', rect.top + window.pageYOffset - 10 + 'px');

        // Highlight callout
        d3.select(this).select('.callout-icon-bg').attr('fill', '#f0f0f0');
      })
      .on('mouseleave', function () {
        // Remove tooltip
        d3.select('.callout-tooltip').remove();

        // Reset highlight
        d3.select(this).select('.callout-icon-bg').attr('fill', 'white');
      });

    if (additional?.updateOnZoom) additional.updateOnZoom({ transform, width, height });
  }

  return svg.node();
}
