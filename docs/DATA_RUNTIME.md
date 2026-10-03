# Running and checking the data runtime

## Uploads: ready without configuration

Run `npm ci`, `npm run check`, `npm test`, `npm run build`, then `npm run dev`.
The server listens on loopback port5190. The existing strict origin/session checks remain in force.
Imports use en-US numeric punctuation by default; set AGENS_IMPORT_LOCALE=de-DE for German
numeric punctuation. CSV uses commas, so values containing decimal commas must be quoted.
Default health now reports data `ready` and dataConnectorsImplemented=true; this says the
code is installed, not that any owner's external source has been verified. Voice/planning remain unavailable.

In another terminal run:

```sh
npx tsx scripts/data-smoke.ts
```

It reads only the committed synthetic workbook, discovers Revenue, uploads four rows, queries
total700 and retrieves the stored evidence through the running HTTP API. It prints a short JSON
summary without private data or credentials. Set AGENS_SMOKE_ORIGIN to an exact application origin
if using another port/HTTPS proxy. On Matrix run this in your own checkout/account after pulling.
Do not run against another owner's private workspace.

## Configured connectors

No database passwords, provider tokens, URLs or headers are accepted from model query input.
The operator installs an absolute private JSON config outside the repository and sets
`AGENS_SOURCES_FILE=/absolute/private/sources.json` in the server environment. On Unix the loader
requires owner-only file mode0600; on Windows place it in an owner-only directory with restricted
ACLs. The file is read on startup, strictly validated, held in JS private fields and never returned.
Do not commit it. Omitting the variable leaves uploads enabled and connectors unconfigured.

Generate a separate random capability for each source and store only its SHA256 hash in the
config. Give the plaintext capability only to its owner for attachment; never use a database password
as an accessToken. For example the owner can privately generate the pair with:

```sh
node --input-type=module -e "import {randomBytes,createHash} from 'node:crypto'; const t=randomBytes(32).toString('base64url'); console.log({accessToken:t,tokenHash:createHash('sha256').update(t).digest('hex')});"
```

Config shape (replace all placeholders privately, not in Git):

```json
{
  "sources": [
    {
      "id": "revenue_db", "tokenHash": "<64-character SHA256 hash>", "kind": "postgres",
      "connection": {"connectionString": "<private read-only connection URI>"},
      "source": {
        "schema": "analytics", "table": "revenue", "orderBy": ["id"],
        "columns": [{"name":"id","type":"number"},{"name":"region","type":"string"},{"name":"amount","type":"number"}]
      }
    },
    {
      "id": "revenue_api", "tokenHash": "<different SHA256 hash>", "kind": "https",
      "source": {
        "name": "Revenue API", "endpoint": "https://your-api.example/revenue",
        "allowedOrigins": ["https://your-api.example"], "headers": {"Authorization":"<private provider token>"}
      }
    }
  ]
}
```

The role must be a SELECT-only, non-superuser account on the configured table. orderBy must
identify a unique stable ordering key. Table metadata is explicit; schema introspection never opens
unconfigured tables. TLS uses normal verification; `ssl:true` is supported in connection config.
HTTPS responses must be flat scalar object arrays or `{rows:[...],next:"/next-page"}`.
Headers are optional for public APIs. Private networks, redirects and origin changes are blocked.

## HTTP integration contract additions

All endpoints share the existing cookie, exact origin, body size, operation deadline and ownership rules.
The body for inspection is the existing ImportRequest; it does not register a dataset.

| Endpoint | Body | Result |
| --- | --- | --- |
| POST `/api/datasets/inspect` | ImportRequest | `{sheets:["Revenue",...]}`; CSV has no sheets |
| POST `/api/datasets/import` | ImportRequest |201 `{dataset}` (snapshot) |
| POST `/api/sources/connect` | `{sourceId,accessToken}` |201 `{dataset}` only after successful real fetch/query |
| POST `/api/query` | existing QueryRequest | `{result}` with stored query evidence |
| POST `/api/datasets/:id/refresh` | `{}` | `{dataset}` with same public ID and updated capture/schema |
| GET `/api/datasets/:id/status` | none | datasetId, state, lastVerifiedAt, optional safe lastError |

Connect only names a preconfigured source and proves its capability. One source can be claimed
by one browser session at a time; another session cannot query/refresh its dataset, attach its source,
or read its evidence. Expiry/server-close disposes connector state and releases the claim.
The capability is not a replacement for production account authentication: a production ingress
still needs authenticated HTTPS. Runtime binds only to loopback; do not expose it directly.

Failed connect creates no public dataset. Failed refresh/query keeps the last verified capture
and old evidence, returns503, and status reports failed. A successful refresh clears the error.
Uploaded workbook refresh returns400: upload a new snapshot. Refresh can change schema, so callers
must reload metadata and build a new validated query. Existing query evidence remains immutable.

Source-settings UI is owned by Riyad's canvas track. These endpoints are the implementation
boundary for that UI; no canvas or voice code was changed here. Existing import/query tool shapes
remain compatible. Local smoke checks do not establish live voice or a completed dashboard.

## Verification on 3 October 2026

- Running compiled server entrypoint: real HTTP sheet discovery/upload/query/evidence; total700.
- Full suite with integrations enabled: 33 passing tests, zero skipped; TypeScript and build pass.
- Real PostgreSQL15 disposable SCRAM-authenticated cluster on loopback port55439, with a dedicated
  SELECT-only role and four synthetic rows. Verified region totals250/450, forbidden INSERT,
  cross-session isolation, refresh, failure after privilege revocation, recovery, write-capable
  role rejection, >10,000-row rejection, and a pg_sleep source stopped by the3sec statement timeout.
- Real HTTPS: public JSONPlaceholder `/posts` through production connect/query/refresh endpoints,
  with DNS pinning and ordinary TLS validation. This provider serves synthetic data; no private API
  account or credentials were used. That network test found and fixed Node's `lookup(...,{all:true})`
  callback compatibility.
- Default CI runs local HTTP/config/security tests. External tests opt in with
  AGENS_TEST_POSTGRES_URL, optional AGENS_TEST_POSTGRES_ADMIN_URL and AGENS_TEST_PUBLIC_API=1.
  Use only a dedicated disposable fixture database containing analytics.revenue(id,region,amount)
  and role agens_reader: admin-enabled tests temporarily change that fixture's grants and create/drop
  uniquely named fixture views. They must never point at a production database.
- The isolated database and development server were stopped after validation.
  Owner-specific workbooks and external services require separate connection checks.
