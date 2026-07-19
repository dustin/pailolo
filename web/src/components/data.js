import _ from 'npm:lodash';
import * as d3 from 'npm:d3';

export async function fetchResults(f) {
  return f()
    .csv({ typed: true })
    .then(data =>
      data.map(d => {
        const finished = new Date(d.finish_ts * 1000);
        return {
          ...d,
          finished: finished,
        };
      })
    );
}
export async function fetchTrails(f) {
  return f()
    .csv({ typed: true })
    .then(data =>
      data.map(d => {
        const ts = new Date(d.ts);
        return {
          ...d,
          ts: ts,
        };
      })
    )
    .then(rows => _.groupBy(rows, 'bib'));
}
