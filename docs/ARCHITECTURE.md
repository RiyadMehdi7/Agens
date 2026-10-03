# Architecture

## Runtime and models

Matrix hosts the repository, Codex session, backend, preview and project artifacts.
Codex writes and reviews code. Gemini powers the product at runtime; these are separate roles.
Use Vite + React + TypeScript for the future canvas, Node for backend routes and @google/genai.
Use gemini-3.8-live for audio and gemini-3.8-flash for planning via the Interactions API.
Keep slow planning out of the voice loop and report its result through asynchronous function responses.

## Intended flow

Microphone → Gemini Live → validated tool request → backend data adapter → query evidence
→ Gemini Flash chart plan → validated dashboard action → renderer → tool result → spoken explanation.

Live response modality is AUDIO with output transcription when needed. Input is mono 16-bit PCM
at 16 kHz; output PCM is 24 kHz. Use supported audio plumbing and test interruption, cleanup,
reconnect, session resumption and denied microphone states. No permanent key in the browser.
Do not set unsupported thinking_config on the base 3.8 Live model.

## Data boundary

Excel: parse bounded workbooks; select sheets and handle dates, locale numbers and missing values.
Database: read-only account, parameterized approved queries, row/time limits, schema allowlist.
API: owner-configured HTTPS origins, credential vault, timeouts, pagination bounds; block arbitrary
model-provided URLs, private-network targets and unsafe redirects unless explicitly configured.
Every result has dataset/query IDs, filters, aggregation, captured time and truncation status.
Freshness belongs to the dataset; an uploaded workbook is a snapshot, even in a live conversation.

## Canvas boundary

Dashboard actions use stable chart IDs and expectedRevision to reject stale asynchronous edits.
Changing chart type preserves dataset and query references. Reordering includes every chart once.
Selection resolves “this”; ambiguous references require clarification in the voice interaction.
Validate chart fields against the actual source schema and verify query ownership before applying.
The current reducer validates shape only; the future backend enforces ownership and field access.

## Extension path

Registry starts with line/bar/table/metric renderers. Add area/scatter/heatmap/treemap/sankey
through explicit implementations. Render model plans as data, never unrestricted executable code.
Use a sandbox without host credentials for custom visualization code, if added later.
