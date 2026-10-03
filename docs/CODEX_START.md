# First task for Codex inside Matrix

Read AGENTS.md and the docs. Build Agens, a voice-first general analytics canvas using
Gemini 3.8 Live plus Gemini 3.8 Flash. Preserve the foundation contracts.

Install/use the official Gemini API development skill and Matrix app-building skills.
Fetch the current Live, asynchronous tools, ephemeral token and Interactions docs before API code.
Verify the actual account's model access; do not silently downgrade models.

First implement Excel ingestion with deterministic query evidence, then a Vite React canvas with
line/bar/table/metric renderers and a bottom voice control. Add Gemini Live via ephemeral tokens
or a server relay. Route tool calls through schema/ownership validation; return actual query results.
Use Gemini 3.8 Flash for bounded chart plans while the user keeps talking.
Support add/update/remove/reorder/select and questions about selected charts. Keep filters on
chart-type changes. Reject stale edits and prevent cancelled tool work from overwriting the canvas.

Use FinAstra's voice-first interaction as a reference, but do not reuse its OpenAI transport.
Do not claim arbitrary visualization support, live data or causal explanations without evidence.

Run checks and browser verification. Test microphone denial, interruption, reconnect, no-data,
malformed workbook, unavailable models, quota failure, ambiguous chart references and stale actions.
Report exactly which evidence is local, Matrix, sample, uploaded and real provider execution.
