# Frontend — issue #3

Vite + React + TypeScript canvas in `src/**`, built against the #1 API contract (`docs/API_CONTRACT.md`).
`src/voice/**` is reserved for issue #4 and is not created here.

## Running

```sh
npm ci
APP_ORIGIN=http://127.0.0.1:5173 npm run dev   # API on 127.0.0.1:5190
npm run dev:web                                # canvas on 127.0.0.1:5173, /api proxied
```

The proxy keeps the browser's Host and Origin, which the API checks against `APP_ORIGIN`.
If ports differ, set `PORT` for both commands and pass `--port` to `npm run dev:web`.
`npm run build` emits the server to `dist/` and the canvas to `dist/web/`.

## Design

Minimal and voice-first: a dark canvas plus a bottom dock with three round controls:
sources (left), microphone (centre), add chart (right). Nothing else is on screen.

- **Fog → reveal.** While a query runs, its tile renders a blurred placeholder over a drifting
  colour orb. When evidence arrives the chart comes into focus (`.fog` → `.reveal`). The mic ring spins
  while anything is in flight. Changing a chart's type replays the reveal.
- **Reduced motion.** `prefers-reduced-motion` turns animation off; loading tiles stay statically blurred.
- Tokens and animations live in `src/styles.css`.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/api/http.ts` | Typed client for `/api/datasets`, `/api/datasets/import` and `/api/query`. Validates every response with the shared Zod schemas. On a 401 it retries once with a fresh session and notifies the canvas, which clears stale dataset/query references. |
| `src/api/errors.ts` | Maps contract error codes to user-safe text. Server messages are never shown verbatim. |
| `src/api/sample.ts` | In-browser **sample** fixture used only when the server reports no data adapter. The dataset's freshness is `sample`, the name says synthetic, and every tile shows a small `sample` mark. |
| `src/canvas/plan.ts` | Turns a manual chart request into a bounded declarative `QueryRequest` (no SQL or JS). Voice planning should produce the same shape. |
| `src/canvas/registry.ts` | Renderer registry covering every kind in the shared schema: line, area, bar, donut (`pie`), treemap, metric, scatter, heatmap, sankey and table. Each renderer validates the actual `QueryResult` rows and `chart.fields` before drawing (types, arity, non-negative part-of-whole values, category limits) and returns a readable reason when they do not fit. Layout maths (signed bars, squarified treemap, donut arcs, sankey bands) lives in `src/canvas/geometry.ts` and is unit-tested. |
| `src/canvas/useCanvas.ts` | Canvas state. `dispatch()` is the single entry point for dashboard changes and always goes through the shared `applyDashboardAction` with the current revision. Colour and size are client-side presentation only and never touch the shared dashboard or evidence. |
| `src/components/*` | Chart tiles and renderers, the icon-first sources popover (also used on the empty canvas) and the add panel. |

### Contract usage and invariants

- A chart is added only after its query returns, so `queryId` always refers to real evidence.
  Until then a client-only pending tile is shown.
- Changing chart type sends `update` with `{kind}` only. Dataset, query and fields are unchanged.
  If the data no longer fits (for example a 9-row result shown as a metric), the tile says so instead of re-querying.
- Reorder sends the complete chart ID list. Remove clears selection through the reducer.
  Selection is the reducer's `selectedChartId`, which is how “this chart” will resolve for voice.
- Tiles carry no footer. The full evidence record (aggregation, freshness, capture time, truncation) is the chart title's tooltip; synthetic data and truncated results are always marked inline with `sample` / `partial`.
- Workbooks are inspected first (`POST /api/datasets/inspect`); a multi-sheet workbook shows its sheets as chips and imports the one picked.
- Postgres and API tiles open a two-field form (source ID and access token) that calls `POST /api/sources/connect`. The token is sent once and never stored by the canvas. Wrong IDs/tokens get one generic message.
- Live sources show a refresh control. `POST /api/datasets/:id/refresh` is followed by re-running every chart on that dataset with the exact `normalizedRequest` recorded in its evidence; each chart is then pointed at the new evidence (remove/add/reorder through the shared reducer, keeping position and selection). A chart whose request no longer fits the refreshed schema keeps its earlier evidence and the status line says so. A failed refresh turns the source's dot red.
- After a reload the canvas lists the session's datasets again. Charts are client state and are not restored.

## States covered

Empty (no source), importing (fogged card), dataset connected with no charts, query in flight,
no rows, truncated results, chart/data mismatch, unsupported kind, import errors (wrong type, >256 KB, malformed,
server without a data engine), expired session, unreachable API, and voice unavailable until #4.

## Verification (October 3, local laptop, not Matrix)

- After merging `main` (#1, #2, #5): a 3-sheet synthetic workbook listed Revenue/Headcount/Notes and imported the chosen sheet; a locally configured public HTTPS source (JSONPlaceholder, synthetic) rejected a wrong source ID, connected with its capability, charted, refreshed and re-queried. Local config and token lived outside git.

- `npm run check`, `npm test` and `npm run build` pass.
- Browser, against a **local, uncommitted** integration of this branch with `codex/2-data-engine`'s
  `createWorkbookAdapter`:
  - `tests/fixtures/synthetic-revenue.xlsx`: metric 700, regions South 450 / North 250 (Tariel's expected totals).
  - A synthetic 36-row CSV: total 4,312,000; North America 1.7M, Europe 1.4M, APAC 840.8K, LATAM 409.6K.
  - Add (line, bar, metric, table), type switching with unchanged evidence, complete reorder, remove,
    select/Escape, resize, recolor, phone width, dataset restore after reload.
  - Import errors and a stale-session upload against the #1 skeleton (`NOT_IMPLEMENTED` shown honestly).
- Not yet done: Matrix browser run, screenshots attached to the PR, and switching to the merged #2 endpoints.
