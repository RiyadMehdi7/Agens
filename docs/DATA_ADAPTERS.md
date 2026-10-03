# Data adapters — issues #2 and #5

This implementation builds on `codex/1-api-contract` and preserves its shared schemas.
The original engine PR did not change frontend, voice, entrypoint or routes. The follow-up now
wires uploads and connectors into server/app.ts and the HTTP runtime; see DATA_RUNTIME.md.
No frontend or voice code is changed. The original createWorkbookAdapter factory remains available.
Dependency proposal for review: ExcelJS 4.4 for XLSX, yauzl for bounded archive validation,
pg 8.16 for Postgres, and their TypeScript types. Package/lockfile changes must be coordinated
with the integration owner before merging. No contracts are replaced.

## Workbook import and deterministic evidence

`WorkbookAdapter` is instantiated per session. It implements `SessionDataAdapter` using private
in-memory tables/raw values and detached immutable evidence copies; no uploads are written to Git.
Dispose clears the tables/evidence. Maximum 20 tables and 8MiB stored raw/normalized data;
50 unique evidence records and 10MiB total retained state. The HTTP service additionally
enforces session ownership, expiry, deadlines and public-ID mapping.

Imports accept the existing JSON/base64 contract, with 256KiB compressed/input bytes,
8MiB actual expanded XLSX ZIP content, 20 sheets, 10,000 data rows, 100 columns,
100,000 cells across workbook sheets and 4096 characters per cell.
XLSX XML parsing runs in a worker with a 128MiB heap and four-second deadline, isolating
sparse-sheet allocation and allowing termination without blocking the server event loop.
CSV uses strict UTF-8 and RFC-style quoted commas/newlines/escaped quotes. A malformed quote
or ragged trailing extra column is handled explicitly; extra cells get generated headers.
Blank headers become column_N; duplicates get _2/_3 suffixes; reserved prototype names
are renamed. Empty rows are skipped and missing/empty cells become null. ISO dates are
validated; date/number/boolean columns are inferred only when all non-null values agree.
Mixed columns retain original text and useful raw cells are stored privately.
Locale is owner-configured (`en-US` default or `de-DE`) rather than guessed: `1,234.50`
and German `1.234,50` are supported under the respective locale. Leading-zero identifiers
remain text. No formulas/macros are executed; formula cells and macro payloads are rejected.
Hyperlinks are kept as text and external workbook links are never fetched.

`inspectWorkbook(buffer)` returns available sheet names within the same bounds. The current
HTTP contract has sheet selection but no discovery endpoint: wiring discovery is an additive
integration decision for issue #1. `sheet` selects a worksheet by name; omitted means first sheet.

Example import:

```ts
const service = new ApiService({createAdapter: createWorkbookAdapter});
const session = service.session().id;
const {dataset} = await service.import(session, {
  format: 'csv', name: 'Revenue',
  contentBase64: Buffer.from('month,region,revenue\n2026-01-01,North,100\n2026-01-01,South,200\n2026-02-01,North,150\n2026-02-01,South,250\n').toString('base64')
});
const {result} = await service.query(session, {
  datasetId: dataset.id, groupBy: ['region'],
  aggregates: [{op: 'sum', field: 'revenue', alias: 'total'}]
});
// rows: [{region:'North', total:250}, {region:'South', total:450}]
```

Monthly totals are 300 and 400; overall total is 700. `tests/fixtures/synthetic-revenue.xlsx`
is a genuine, entirely synthetic workbook; tests also generate workbooks in memory.
No real uploads enter the repository. Uploaded data is always snapshot;
only deliberately configured test datasets are sample. Adapter query IDs hash the dataset,
capture timestamp, canonical query and result; HTTP generates its own immutable public IDs.
All rich filters remain in normalizedRequest, while the legacy filters map contains only equality
scalars. Query semantics match docs/API_CONTRACT.md including null aggregates, stable sorts,
group encounter order and truncation after sorting. Non-finite arithmetic is rejected.

## Postgres adapter

Construct `PostgresAdapter(privatePoolConfig, {schema,table,columns,orderBy})` only on the server.
The configured table is the allowlist; fields must exist in configured columns. `orderBy` must
name a unique stable ordering key (operator responsibility). Each adapter belongs to one owner/session.
Credentials remain in a JS private pool field, absent from dataset/result records and errors.
Use a dedicated non-superuser SELECT-only role on the configured table; the adapter checks
role capabilities and table write privileges before queries, and runs `BEGIN READ ONLY` plus
3000ms statement timeout. Connections/queries are bounded; abort discards the connection.

Filters compile to parameter placeholders; identifiers are owner-configured and validated,
never model SQL. Read at most 10,001 matching rows and reject if over 10,000 rather than
report an aggregate from incomplete data. Aggregation/projection/sorting use the same evaluator.
This is intended for small analytics sources, not unrestricted scans. Configure numeric columns
that can be represented faithfully as JavaScript finite numbers; high-precision accounting values
need a future decimal contract. Only successful queries mark the dataset live. capturedAt is
the last verified fetch time. Do not treat a previous successful capture as proof of current reachability.

## HTTPS JSON adapter

Construct `HttpsJsonAdapter({endpoint,allowedOrigins,name,headers})` on the server from the
owner's private configuration, not request/model input. Call refresh once to discover columns
and obtain an ID, then query with the shared schema. Accept a JSON array of flat scalar objects,
or `{rows:[...],next:'/next-page'}`. Nested objects are rejected. Empty sources without a schema
are rejected rather than inventing columns. Refresh may discover a changed schema; old queries
are revalidated against the fetched schema.

Only HTTPS port443, configured origins and no URL credentials/fragments. DNS results must all
be public and are pinned for the socket lookup while TLS verifies the original hostname.
Private/loopback/link-local/metadata, mapped/transition/documentation IPs are blocked.
Every redirect is rejected. Pagination remains on the initial origin so credentials are never
forwarded to another origin; five pages, 256KiB per page, 10,000 total rows, 3sec socket timeout
and 4sec operation deadline. No compressed response inflation. Refresh failures return a generic
error and lastError; listDatasets retains the last successful timestamp. New/unverified sources
expose no live dataset. This connector is stricter than a general-purpose fetch proxy.

Connector configuration has no public credential-write endpoint. The follow-up loads an owner-only
operator file through SourceRegistry; each source has a hashed owner capability, is claimed by a
single session and is verified before publication. Never send pool config or headers to the browser,
logs or dataset records. DATA_RUNTIME.md documents the connection and refresh endpoints.

## Evidence status

- Local: type checking, tests and build; real synthetic CSV/XLSX, known totals and API-service
  ownership tests. Connector transport tests use synthetic mocked DNS/HTTPS/pg, not live providers.
- Use private workbooks only in the owner's environment; never commit them.
- Real Postgres/API: follow-up verified a real disposable PostgreSQL15 instance and the public
  JSONPlaceholder API with synthetic data. Owner-specific services remain unverified.
- Live Gemini voice and dashboard: owned by other tracks, not claimed here.

Record provider acceptance in the relevant issue before closing it. No automatic merge.
