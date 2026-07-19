---
theme: dashboard
title: M2M Results
toc: true
---

# M2M Race Results

```js
import {fetchResults, fetchTrails} from "./components/data.js";
import {renderRun, createColorizer, findCallouts, findFastest1kSegment} from "./components/map.js";
import * as fmt from "./components/formatters.js";

const [allResults, allTrails] = await Promise.all([
  fetchResults(() => FileAttachment('data/results.csv')),
  fetchTrails(() => FileAttachment('data/trails.csv')),
]);

const contests = [...new Set(allResults.map(d => d.contest_name))].sort();

const contestInput = Inputs.checkbox(contests, {
  multiple: true,
  label: "Contest",
});
const selectedContests = Generators.input(contestInput);
```

```js
const divisions = [...new Set(allResults.filter(d => selectedContests.includes(d.contest_name)).map(d => d.age_group))].sort();

const divisionInput = Inputs.checkbox(divisions, {
  multiple: true,
  label: "Age Group",
  value: divisions});

const selectedDivisions = Generators.input(divisionInput);
```

```js
const filteredResults = allResults.filter(d => selectedContests.includes(d.contest_name) && selectedDivisions.includes(d.age_group));
```

```js
contestInput
```

```js
divisionInput
```

Select some racers whose trails you'd like to see.

```js
const table = Inputs.table([...filteredResults].sort((a, b) => {
    if (a.place == null && b.place == null) return 0;
    if (a.place == null) return 1;
    if (b.place == null) return -1;
    return a.place - b.place;
  }), {
    columns: [
      "place",
      "bib",
      "name",
      "contest_name",
      "age_group",
      "age_group_rank",
      "gun_time_seconds",
      "finished",
    ],
    header: {
      bib: "Bib Num",
      name: "Name",
      "contest_name": "Contest Name",
      place: "Place",
      age_group: "Age Group",
      age_group_rank: "Age Group Rank",
      gun_time_seconds: "Gun Time",
      finished: "Finish Time",
    },
    format: {
      finished: fmt.time,
      gun_time_seconds: fmt.seconds,
    },
    required: false,
    select: true,
  });

table.querySelector("tbody").addEventListener("click", (event) => {
  if (event.target.tagName === "INPUT") return;
  const tr = event.target.closest("tr");
  if (!tr) return;
  const checkbox = tr.querySelector('input[type="checkbox"]');
  if (checkbox) checkbox.click();
});

table.querySelectorAll("tbody tr").forEach((tr) => {
  tr.style.cursor = "pointer";
});

const selection = view(table);
```

```js
const runs = selection.map(s => allTrails[s.bib]);
const callouts = [];
const fastSegments = [];

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

function hueForBib(bib) {
  const h = (bib * GOLDEN_RATIO_CONJUGATE) % 1;
  return Math.floor(h * 360);
}

const colorizers = selection.map(s => createColorizer(allTrails[s.bib], hueForBib(s.bib)))
```

# Lines

```js
html`<div>${selection.map(s => html`
  <span style="
    display: inline-block;
    margin: 2px 6px 2px 0;
    padding: 2px 8px;
    border-radius: 4px;
    color: hsl(${hueForBib(s.bib)}, 70%, 85%);
    border: 1px solid hsl(${hueForBib(s.bib)}, 70%, 50%);
  ">${s.name}</span>
`)}</div>`
```

<div class="card">${resize(width => {
    if (runs.length === 0) {
        return;
    }
    // const fastestSegments = runs.map(o => findFastest1kSegment(o));
    return renderRun(width, runs, callouts, { fastestSegments: fastSegments, colorizers: colorizers });
    })
}</div>
