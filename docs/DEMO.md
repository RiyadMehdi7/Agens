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

## Postgres and API connectors (local)

```sh
bash scripts/local-postgres.sh
AGENS_SOURCES_FILE=$HOME/.agens/sources.json npm run demo
```

The script starts a disposable `agens-postgres` container on `127.0.0.1:55432` with 108 synthetic rows in
`analytics.revenue` (month, region, channel, revenue, accounts) and a SELECT-only `agens_reader` role. It writes the
private connector config and access tokens to `~/.agens` (mode 0600) and never prints secrets. In the canvas:

| Tile | Source ID | Access token |
| --- | --- | --- |
| Postgres | `revenue_db` | `revenue_db` line of `~/.agens/access-tokens.txt` |
| API | `posts_api` | `posts_api` line of the same file (public synthetic JSONPlaceholder posts) |

Copy a token: `awk '$1=="revenue_db"{printf "%s", $2}' ~/.agens/access-tokens.txt | pbcopy`.
Expected Postgres totals by region: North America 1,681,684; Europe 1,379,840; APAC 840,844; LATAM 409,644.
Remove it with `docker rm -f agens-postgres && rm -rf ~/.agens`.

## Matrix

Matrix OS was the team's development computer. The app is not run there: Matrix app windows are sandboxed iframes
without microphone access, the app proxy strips cookies and cuts requests at 30 s, and port forwarding returned
empty responses during testing (3 October 2026).

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
| Combined frontend/backend with documented start command | Done: `npm run demo` serves both on one loopback port. Run locally; running on Matrix was dropped (see above). |
| Upload → speak → interrupt → change type → reorder/remove → ask about a trend | Manual and tool paths are implemented and tested locally. **Spoken run not done**: no key on the laptop. |
| Values match known totals; type/filter changes keep evidence; stale work never overwrites | Totals checked by `smoke:demo` and the tests. Type change keeps the query. Cancelled or stale plans are discarded (tested). |
| Mic denial, reconnect, no data, malformed workbook, model/quota failure, ambiguous references | Mic denial, no data, malformed files, model failure and ambiguity are handled and tested. Model failure was also seen in the browser with an invalid key. Reconnect is implemented but untested against the live service. |
| Interview one real user | **Not done.** Product fit remains a hypothesis. |
| Screenshots, reproducible steps, real-provider results, known limits | Steps above; `smoke:demo` with the team key produces provider evidence. Screenshots and provider results are still to attach. |
| README and health reflect real capabilities | Updated. Health says voice is `configured`, not verified. |

## Known limits

- Sessions, datasets and charts are in memory; nothing persists across restarts. Charts are client state.
- Uploads are capped at 256 KB and are snapshots. Live sources need the operator's private config.
- The planner may skip drafts that do not fit the schema; skipped reasons are returned and spoken.
- The ten chart types are the shared schema's. Anything else needs a schema change first.
