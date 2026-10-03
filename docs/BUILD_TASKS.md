# Product build assignments

[Working voice analytics milestone](https://github.com/RiyadMehdi7/Agens/milestone/1).
GitHub issue assignment records responsibility; it does not start another person's Codex session.
Each issue contains file ownership, dependencies, acceptance criteria and a Codex handoff.

## Riyad — RiyadMehdi7

1. [#1 Shared contracts and integration skeleton](https://github.com/RiyadMehdi7/Agens/issues/1).
2. [#3 Canvas, sources and chart controls](https://github.com/RiyadMehdi7/Agens/issues/3).
3. [#4 Gemini 3.8 Live and asynchronous planning](https://github.com/RiyadMehdi7/Agens/issues/4).
4. [#6 Integration and verified Matrix demo](https://github.com/RiyadMehdi7/Agens/issues/6).

Give your Codex session this prompt:

> Read GitHub issue #1 in RiyadMehdi7/Agens and AGENTS.md. Implement the shared contracts and
> integration skeleton in an isolated codex/1-api-contract branch. Tariel's Codex owns server/data/**;
> preserve its work and coordinate the API shapes in issue #1. Follow the issue's acceptance criteria,
> run the required checks and open a PR linking #1. Do not merge automatically. Continue with #3,
> then #4, only after their dependencies are agreed; coordinate the final demo through #6.

## Tariel — tariel-aliev

1. [#2 Excel/CSV and query engine](https://github.com/RiyadMehdi7/Agens/issues/2).
2. [#5 Postgres and HTTPS JSON API adapters](https://github.com/RiyadMehdi7/Agens/issues/5).

Give Tariel's Codex session this prompt:

> Read GitHub issue #2 in RiyadMehdi7/Agens and AGENTS.md. Implement the bounded workbook/CSV
> ingestion and deterministic query engine in an isolated codex/2-data-engine branch. You own
> server/data/**, its tests, synthetic fixtures and docs/DATA_ADAPTERS.md. Riyad's Codex owns
> shared contracts, routing, canvas and voice. Coordinate contract changes in #1, preserve other
> changes, follow #2's acceptance criteria and open a PR linking #2 with known-total test evidence.
> Do not merge automatically. Continue to #5 after the data boundary is ready. Keep credentials
> and real uploaded data out of Git and use your own Matrix authentication.

## Working order

Tariel can start the pure parser/query modules immediately using the current shared interfaces.
Riyad establishes the common API contract first. Both tracks can then build independently;
the canvas may use clearly labelled fixtures until the real data endpoints land.
Issue #6 is complete only after actual uploaded data and live Gemini audio work together on Matrix.
Database/API connections are the next capability and must have separate real-connection evidence.

Keep implementation discussions in the relevant GitHub issues. Proposed dependency additions
and shared-file changes need coordination before the two PR tracks are merged.
