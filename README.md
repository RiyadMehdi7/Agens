# Agens

Voice-first analytics canvas built with Gemini 3.8 Live, developed with Codex inside Matrix OS.
Connect Excel, a read-only database, or an API; speak to build and change a dashboard,
ask about a selected chart, compare periods, and explain trends from actual query results.

## Current status

The backend now starts with bounded Excel/CSV ingestion, deterministic analytics queries,
session-owned immutable evidence, worksheet discovery, and owner-configured read-only Postgres
and HTTPS JSON connectors. Uploads work without connector configuration. See
[data setup and verification](docs/DATA_RUNTIME.md) for connection setup and a repeatable smoke check.
Frontend, live audio and renderer work remain separate tracks; this is not yet a complete voice dashboard.

## Local validation

Use Node 22 or later.

```sh
npm ci
npm run check
npm test
npm run build
npm run dev
```

Health: http://127.0.0.1:5190/api/health. The foundation binds only to loopback.
Copy `.env.example` to `.env.local` if testing Gemini metadata and enter the key privately.
`npm run verify:gemini` checks model access, without generating audio or dashboards.

## Matrix setup

See [docs/MATRIX_SETUP.md](docs/MATRIX_SETUP.md). This checkout must be cloned and verified on the
Matrix computer. A local setup or successful push does not satisfy that requirement.
Use [docs/CODEX_START.md](docs/CODEX_START.md) as the first prompt for Codex there.

## Product and evidence

- [Product scope](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Read reference documents](docs/REFERENCES.md)
- [Team workflow](CONTRIBUTING.md)
