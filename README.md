# Agens

Agens is a voice-first analytics canvas. Connect your data, ask for a dashboard,
and keep talking as the charts appear. You can change the view, compare periods,
and ask about a selected chart without losing its filters.

We developed Agens inside **Matrix OS**, using Codex and Claude Code as coding
agents. The application uses **Gemini 3.8 Live** for audio conversations and model
tool calls, with **Gemini 3.8 Flash** handling dashboard planning in the background.

## What you can do

- Import Excel (`.xlsx`) or CSV files and choose a worksheet.
- Connect a read-only PostgreSQL database or a configured HTTPS JSON API.
- Build and edit charts by voice or with the canvas controls. Filter dates,
  compare measures, change chart types, colors and sizes, and rearrange the dashboard.
- Ask about the data behind a chart. Answers use query results; the application
  should say when those results cannot explain a cause.
- Draft an email with an image of the current dashboard attached, review it on
  the canvas, and send it through Gmail to a contact in your configured directory.

The canvas supports line, area, bar, donut, scatter, heatmap, treemap, Sankey,
table and metric views. Each renderer checks whether the returned data fits.

## Run locally

You need Node.js 22 or later. Docker is needed only for the PostgreSQL demo.

```sh
npm ci
npm run check
npm test
npm run demo
```

Open [Agens on localhost](http://127.0.0.1:5190). For voice, set `GEMINI_API_KEY`
in a private `.env.local` file. The permanent key stays on the server; the browser
receives a single-use ephemeral token. Run `npm run verify:gemini` to check model
metadata access on your account. The app does not fall back to older models.

For hot reload, run these in separate terminals:

```sh
APP_ORIGIN=http://127.0.0.1:5173 npm run dev
npm run dev:web
```

## Demo data

Our database demo uses **PostgreSQL 16 deployed in Docker**. The local container
is `agens-postgres`, reachable at `127.0.0.1:55432`; the data is in database
`agens`, table `analytics.revenue`. It is synthetic demo data.

Start the app against the existing demo configuration:

```sh
AGENS_SOURCES_FILE=$HOME/.agens/sources.json npm run demo
```

Choose Postgres in the canvas, enter source ID `revenue_db`, and use its access
token from the private `~/.agens/access-tokens.txt` file. Database credentials
stay on the server. The same configuration includes a public synthetic API source,
`posts_api`.

For a fresh fixture, `bash scripts/local-postgres.sh` creates Docker PostgreSQL,
loads 108 synthetic rows and writes private configuration under `~/.agens`.
**It replaces `analytics.revenue` when rerun.** The current demo database has a
larger dataset; see [the demo guide](docs/DEMO.md) before using the script.

## Email a dashboard report

Ask Agens to draft an email for a directory contact. Review the recipient,
message and attached dashboard image on the canvas, then explicitly send it. Gmail needs server-side OAuth configuration and a real contact directory.
Without them, the app rehearses the flow with demo contacts and sends no external mail.

The PNG attachment captures the dashboard as it looks when the draft is created,
including chart layout, colors, filters and legends. You can preview or download
it before sending. Create a new draft to capture later dashboard changes.

Gmail configuration uses `AGENS_GMAIL_FILE`; the contact directory uses
`AGENS_CONTACTS_FILE`. Both point to private server-side files outside Git.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Demo](docs/DEMO.md) | Running the demo, data locations and verification |
| [Product](docs/PRODUCT.md) | The workflow and current limits |
| [Architecture](docs/ARCHITECTURE.md) | Models, tools, data and canvas boundaries |
| [Voice](docs/VOICE.md) | Live audio, background planning and recovery |
| [Data runtime](docs/DATA_RUNTIME.md) | Private connector configuration and checks |
| [Data adapters](docs/DATA_ADAPTERS.md) | Import limits and query semantics |
| [Frontend](docs/FRONTEND.md) | Canvas behavior and modules |
| [API](docs/API_CONTRACT.md) | Routes, sessions and schemas |
| [Matrix setup](docs/MATRIX_SETUP.md) | Development environment |
| [Setup record](docs/SETUP_STATUS.md) | Historical Matrix checks |
| [References](docs/REFERENCES.md) | Event briefs and technical sources |
| [Contributing](CONTRIBUTING.md) | Team workflow |

Local checks, Matrix development, live microphone use and Gmail delivery are
separate checks. The demo guide explains how to verify each one.
