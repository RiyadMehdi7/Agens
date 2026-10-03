# Running and proving the demo — issue #6

## One-port app

`npm run demo` builds the server and the canvas and starts one loopback server that serves both
(`/api/*` and the built canvas from `dist/web`). The default origin is `http://127.0.0.1:5190`.

```sh
npm ci
npm run demo                 # build + start on 127.0.0.1:5190
npm run smoke:demo           # in another terminal: end-to-end check of the running app
```

Development keeps hot reload: `APP_ORIGIN=http://127.0.0.1:5173 npm run dev` plus `npm run dev:web`.

The server reads `GEMINI_API_KEY` from the environment or the private `.env.local` (mode 0600). Without it,
data features work and voice reports "not configured". `AGENS_SOURCES_FILE` optionally points at the private
connector config (see DATA_RUNTIME.md). Neither file is ever committed or sent to the browser.

## On Matrix

1. In the Matrix checkout (`/home/matrix/home/projects/agens`): `git pull`, `npm ci`, `npm run check`, `npm test`.
2. Start the app in a persistent Matrix terminal: `npm run demo`. Leave it running. To restart, run the same command again.
3. On the laptop, forward the port: `matrix port forward 5190`, then open http://127.0.0.1:5190 in Chrome.
   Loopback counts as a secure context, so the microphone works. Use a headset to avoid echo.
4. In a second Matrix terminal: `npm run smoke:demo`. With the team key this issues a real Live token and runs a
   real Gemini 3.8 Flash plan. Paste its JSON (it contains no secrets) into the issue as evidence.

If the Matrix terminal drops, reattach with `matrix shell connect --profile cloud --project main --tab <tab>`
(SETUP_STATUS.md lists the tab). The server holds no durable state: a restart clears sessions, so re-upload.

## Demo script

1. Drop `tests/fixtures/synthetic-revenue.xlsx` (or a real workbook) on the File tile; pick the sheet.
2. Tap the mic: "Build a revenue dashboard by month and region." Placeholders fog in while Flash plans; keep talking.
3. Interrupt while it is speaking or planning: "Actually, make the monthly one an area chart."
4. "Put the region comparison first." / "Remove the table."
5. Select a chart (tap its title): "Why is this lower in January?" The answer should quote measured values and say
   when the workbook cannot explain a cause.
6. Expected totals for the synthetic workbook: total 700; North 250, South 450; January 300, February 400.

## Acceptance status (3 October 2026)

| #6 criterion | Status |
| --- | --- |
| Combined frontend/backend with documented start command | Done: `npm run demo` serves both on one loopback port; Matrix preview by `matrix port forward 5190`. Not yet run on Matrix. |
| Upload → speak → interrupt → change type → reorder/remove → ask about a trend | Manual and tool paths are implemented and tested locally. **Spoken run not done**: no key on the laptop. |
| Values match known totals; type/filter changes keep evidence; stale work never overwrites | Totals checked by `smoke:demo` and the tests. Type change keeps the query. Cancelled or stale plans are discarded (tested). |
| Mic denial, reconnect, no data, malformed workbook, model/quota failure, ambiguous references | Mic denial, no data, malformed files, model failure and ambiguity are handled and tested. Model failure was also seen in the browser with an invalid key. Reconnect is implemented but untested against the live service. |
| Interview one real user | **Not done.** Product fit remains a hypothesis. |
| Screenshots, reproducible steps, real-provider results, known limits | Steps above; `smoke:demo` produces provider evidence on Matrix. Screenshots and provider results are still to attach. |
| README and health reflect real capabilities | Updated. Health says voice is `configured`, not verified. |

## Known limits

- Sessions, datasets and charts are in memory; nothing persists across restarts. Charts are client state.
- Uploads are capped at 256 KB and are snapshots. Live sources need the operator's private config.
- The planner may skip drafts that do not fit the schema; skipped reasons are returned and spoken.
- The ten chart types are the shared schema's. Anything else needs a schema change first.
