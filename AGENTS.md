# Agens development instructions

Build a voice-first analytics canvas inside Matrix OS using Codex as the coding agent.
Gemini 3.8 Live is the product voice model; Gemini 3.8 Flash handles slow planning work.
Read README.md, docs/PRODUCT.md, docs/ARCHITECTURE.md and docs/REFERENCES.md first.

## Boundaries
- Preserve user work. Never copy secrets from the laptop to Matrix.
- Never commit keys, uploaded data, database credentials, OAuth files or recordings.
- Keep permanent Gemini keys server-side. Browser Live connections require ephemeral tokens.
- Voice is the primary interaction. Keep a focused canvas and bottom microphone control.
- Reuse validated dashboard commands for voice and manual controls. Preserve query/filter context.
- Only claim a trend after a data tool returns its evidence. Mark snapshots and samples explicitly.
- Excel, database and API sources need bounded read-only adapters, schema validation and provenance.
- Never execute arbitrary model-generated JS/SQL in the host. Custom visuals need a sandboxed renderer.
- Do not promise every chart exists. Extend a renderer registry and expose unsupported kinds honestly.
- Do not silently substitute older Gemini models. Verify model access on the actual account.

## Commands
npm ci
npm run check
npm test
npm run build
npm run dev
npm run verify:gemini

## Delivery
Use branches prefixed codex/. Keep GitHub PRs small and explain what was verified.
Local tests, Matrix execution, live voice, connected data and deployed runtime are separate evidence.
The current repository is a setup foundation, not a working dashboard product.
