# Agens

Voice-first analytics canvas built with Gemini 3.8 Live. Developed with Codex and Claude Code using Matrix OS as the shared development computer.
Connect Excel, a read-only database, or an API; speak to build and change a dashboard,
ask about a selected chart, compare periods, and explain trends from actual query results.

## Current status

Implemented and tested locally (a real spoken Gemini session still needs a run with the team key):

- **Canvas** (`src/**`): minimal voice-first dashboard with ten validated chart types, drag-and-drop uploads,
  sheet picking, Postgres/API connect and refresh, add/change/resize/recolor/reorder/close with undo.
  See [frontend](docs/FRONTEND.md).
- **Data** (`server/data/**`): bounded Excel/CSV ingestion, deterministic queries, immutable evidence and
  owner-configured read-only Postgres and HTTPS connectors. See [data runtime](docs/DATA_RUNTIME.md).
- **Voice** (`src/voice/**`, `server/voice/**`): Gemini 3.8 Live through single-use ephemeral tokens,
  non-blocking tools, and asynchronous Gemini 3.8 Flash planning validated against real schemas. See [voice](docs/VOICE.md).

## Run it

Use Node 22 or later.

```sh
npm ci
npm run check
npm test
npm run demo        # builds and serves API + canvas on http://127.0.0.1:5190
npm run smoke:demo  # end-to-end check of the running app (another terminal)
```

For development with hot reload run `APP_ORIGIN=http://127.0.0.1:5173 npm run dev` and `npm run dev:web`.
Put `GEMINI_API_KEY` in a private `.env.local` (never with a `VITE_` prefix) to enable voice.
`npm run verify:gemini` checks model access. [Demo runbook and acceptance status](docs/DEMO.md).

## Test with Postgres

```sh
bash scripts/local-postgres.sh                              # Docker Postgres + synthetic data + private config in ~/.agens
AGENS_SOURCES_FILE=$HOME/.agens/sources.json npm run demo
```

In the canvas, tap the Postgres tile and enter Source ID `revenue_db` and the `revenue_db` token from
`~/.agens/access-tokens.txt`. See [docs/DEMO.md](docs/DEMO.md).

## Development on Matrix

The team developed the project on Matrix OS ([setup](docs/MATRIX_SETUP.md), [status](docs/SETUP_STATUS.md)).
Running the app on Matrix is not supported: Matrix app windows have no microphone access, and port forwarding
was unreliable during the event. Run the demo locally.

## Product and evidence

- [Product scope](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Read reference documents](docs/REFERENCES.md)
- [Team workflow](CONTRIBUTING.md)
