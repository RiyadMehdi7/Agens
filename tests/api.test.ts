import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createApiServer, type HttpOptions } from '../server/http/router.js';
import { ApiService, type SessionDataAdapter } from '../server/http/service.js';
import { queryRequestSchema, validateQueryForDataset, datasetSchema, type Dataset, type QueryResult } from '../shared/data.js';
import { errorResponseSchema, healthResponseSchema, queryResponseSchema } from '../shared/api.js';

const dataset: Dataset = { id: 'adapter_dataset', sourceId: 'fixture', name: 'Synthetic fixture', kind: 'excel',
  columns: [{ name: 'amount', type: 'number' }], rowCount: 2, capturedAt: '2026-10-03T00:00:00.000Z', freshness: 'sample' };
const upload = { format: 'csv', name: 'Synthetic fixture', contentBase64: Buffer.from('amount\n10\n20\n').toString('base64') };
function fixture(): SessionDataAdapter {
  let imports = 0;
  return {
    listDatasets: async () => [dataset],
    importDataset: async () => ({ ...dataset, id: `adapter_${++imports}` }),
    query: async (datasetId, request) => ({ queryId: 'adapter_query', datasetId, rows: [{ amount: 10 }, { amount: 20 }].slice(0, request.limit),
      capturedAt: dataset.capturedAt, filters: {}, aggregation: 'none', truncated: request.limit < 2 }),
  };
}
async function harness(t: TestContext, options: Partial<HttpOptions> = {}) {
  const app = createApiServer({ origin: 'http://127.0.0.1', createAdapter: fixture, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  t.after(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); });
  let cookie = '';
  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}, raw?: string) => {
    const method = body === undefined && raw === undefined ? 'GET' : 'POST';
    const allHeaders = { Host: '127.0.0.1', ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    // Raw HTTP preserves intentional Host overrides; fetch normalizes Host on Node 26.
    const result = await new Promise<{status: number; body: any; headers: Headers}>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: allHeaders }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('error', reject);
        res.on('end', () => {
          try {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
            }
            resolve({status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()), headers: responseHeaders});
          } catch (error) { reject(error); }
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
    const setCookie = result.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return result;
  };
  return { ...app, call, port, cookie: () => cookie };
}

test('strict bounded query contracts reject invalid combinations and literals', () => {
  const base = { datasetId: 'd' };
  for (const invalid of [
    { sql: 'select *' }, { limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { limit: '2' },
    { projection: ['amount', 'amount'] }, { groupBy: ['amount'] },
    { aggregates: [{ op: 'sum', alias: 'total' }] },
    { aggregates: [{ op: 'count', alias: 'a' }, { op: 'count', alias: 'a' }] },
    { aggregates: [{ op: 'count', alias: '__proto__' }] },
    { aggregates: [{ op: 'count', alias: 'amount' }], groupBy: ['amount'] },
    { aggregates: [{ op: 'count', alias: 'total' }], projection: ['amount'] },
    { aggregates: [{ op: 'count', alias: 'total' }], sort: [{ field: 'amount', direction: 'asc' }] },
    { filters: [{ field: 'amount', op: 'eq', value: { type: 'number', value: Infinity } }] },
    { filters: [{ field: 'amount', op: 'gt', value: { type: 'null', value: null } }] },
    { filters: [{ field: 'amount', op: 'in', values: [{ type: 'number', value: 1 }, { type: 'string', value: '1' }] }] },
    { filters: [{ field: 'amount', op: 'eq', value: { type: 'date', value: '2026-02-30T00:00:00.000Z' } }] },
    { filters: Array(33).fill({ field: 'amount', op: 'eq', value: { type: 'number', value: 1 } }) },
    { projection: Array.from({ length: 101 }, (_, index) => `c${index}`) },
    { filters: [{ field: 'amount', op: 'in', values: Array(101).fill({ type: 'number', value: 1 }) }] },
  ]) assert.equal(queryRequestSchema.safeParse({ ...base, ...invalid }).success, false, JSON.stringify(invalid));
  assert.deepEqual(queryRequestSchema.parse(base), { ...base, filters: [], sort: [], limit: 100 });
  for (const op of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']) {
    assert.ok(queryRequestSchema.safeParse({ ...base, filters: [{ field: 'amount', op, value: { type: 'number', value: 10 } }] }).success);
  }
  assert.throws(() => validateQueryForDataset({ datasetId: dataset.id, filters: [
    { field: 'amount', op: 'eq', value: { type: 'string', value: '10' } },
  ] }, dataset));
  assert.throws(() => validateQueryForDataset({ datasetId: dataset.id, projection: ['unknown'] }, dataset));
  assert.equal(datasetSchema.safeParse({ ...dataset, columns: [...dataset.columns, ...dataset.columns] }).success, false);
});

test('HTTP defaults report unavailable capabilities without configuration disclosure', async t => {
  const { call } = await harness(t, { createAdapter: undefined });
  const health = await call('/api/health');
  healthResponseSchema.parse(health.body);
  assert.equal(health.body.availability.data, 'unavailable');
  assert.equal(JSON.stringify(health.body).includes('credentials'), false);
  for (const [path, body] of [['/api/datasets', undefined], ['/api/datasets/import', upload], ['/api/query', { datasetId: 'd' }],
    ['/api/live/token', {}], ['/api/dashboard/plan', { prompt: 'Build', dashboard: { revision: 0, charts: [], selectedChartId: null }, evidence: [] }]] as const) {
    const response = await call(path, body);
    assert.equal(response.status, 503);
    assert.equal(errorResponseSchema.parse(response.body).error.code, 'NOT_IMPLEMENTED');
  }
});

test('HTTP validates content, bounds, origins and unknown fields', async t => {
  const { call } = await harness(t, { maxBodyBytes: 512 });
  for (const [headers, raw, status] of [
    [{}, '{', 400], [{}, 'x'.repeat(513), 413], [{ 'Content-Type': 'text/plain' }, '{}', 415],
    [{ 'Content-Encoding': 'gzip' }, '{}', 415], [{ Origin: 'https://evil.example' }, '{}', 403],
    [{ 'Sec-Fetch-Site': 'cross-site' }, '{}', 403], [{ Host: 'evil.example' }, '{}', 403],
  ] as const) assert.equal((await call('/api/query', undefined, headers, raw)).status, status);
  assert.equal((await call('/api/query', { datasetId: 'd', sql: 'anything' })).status, 400);
  assert.equal((await call('/api/live/token', { sessionId: 'invented' })).status, 400);
  assert.equal((await call('/api/datasets?sessionId=invented')).status, 400);
  assert.equal((await call('/api/datasets', undefined, { Cookie: 'agens_session=invented' })).status, 401);
  assert.equal((await call('/api/datasets', undefined, { Cookie: 'agens_session=a; agens_session=b' })).status, 401);
  assert.equal((await call('/api/datasets', undefined, { Cookie: '', Origin: 'http://127.0.0.1' })).status, 200);
});

test('chunked oversized bodies return typed 413', async t => {
  const { port } = await harness(t, { maxBodyBytes: 64 });
  const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/query', method: 'POST',
      headers: { Host: '127.0.0.1', 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.write('x'.repeat(65)); req.end();
  });
  assert.equal(result.status, 413);
  assert.equal(JSON.parse(result.body).error.code, 'PAYLOAD_TOO_LARGE');
});

test('sessions own datasets and immutable evidence; tool and planner references must match', async t => {
  const { call, cookie } = await harness(t);
  const imported = await call('/api/datasets/import', upload);
  assert.equal(imported.status, 201);
  assert.match(imported.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  const ownerCookie = cookie();
  const id = imported.body.dataset.id;
  assert.notEqual(id, 'adapter_1');
  const query = await call('/api/query', { datasetId: id, limit: 1, requestId: 'req_1' });
  assert.equal(query.status, 200);
  queryResponseSchema.parse(query.body);
  const qid = query.body.result.queryId;
  assert.deepEqual(query.body.result.rows, [{ amount: 10 }]);
  assert.equal(query.body.result.normalizedRequest.requestId, 'req_1');
  assert.equal((await call(`/api/queries/${qid}`)).body.result.datasetId, id);
  const second = (await call('/api/datasets/import', upload)).body.dataset.id;
  const reference = { datasetId: second, queryId: qid };
  assert.equal((await call('/api/tools/execute', { name: 'get_query', arguments: reference })).status, 409);
  assert.equal((await call('/api/dashboard/plan', { prompt: 'Explain', dashboard: { revision: 0, charts: [], selectedChartId: null }, evidence: [reference] })).status, 409);
  assert.equal((await call('/api/tools/execute', { name: 'get_query', arguments: { datasetId: id, queryId: qid } })).status, 200);
  assert.equal((await call('/api/tools/execute', { name: 'query_data', arguments: { datasetId: id, limit: 1 } })).status, 200);
  assert.equal((await call('/api/query', { datasetId: id, projection: ['unknown'] })).status, 400);
  const foreign = await call('/api/datasets', undefined, { Cookie: '' });
  assert.deepEqual(foreign.body.datasets, []);
  assert.notEqual(cookie(), ownerCookie);
  assert.equal((await call(`/api/queries/${qid}`)).status, 404);
  assert.equal((await call('/api/query', { datasetId: id })).status, 404);
  assert.equal((await call('/api/tools/execute', { name: 'get_query', arguments: { datasetId: id, queryId: qid } })).status, 404);
});

test('evidence is detached from adapter and caller mutations; bad output is rejected', async () => {
  let raw: QueryResult = { queryId: 'q', datasetId: 'adapter_dataset', rows: [{ amount: 10 }],
    capturedAt: dataset.capturedAt, filters: { amount: 10 }, aggregation: 'none', truncated: false };
  const service = new ApiService({ createAdapter: () => ({ ...fixture(), importDataset: async () => dataset, query: async () => raw }) });
  const { id } = service.session();
  const imported = await service.import(id, upload);
  const result = await service.query(id, { datasetId: imported.dataset.id });
  const qid = result.result.queryId;
  raw.rows[0]!.amount = 999;
  result.result.rows[0]!.amount = 888;
  result.result.normalizedRequest!.limit = 1;
  assert.equal(service.evidence(id, qid).result.rows[0]!.amount, 10);
  assert.equal(service.evidence(id, qid).result.normalizedRequest!.limit, 100);
  raw = { ...raw, datasetId: 'wrong' };
  await assert.rejects(service.query(id, { datasetId: imported.dataset.id }), /invalid evidence/);
  raw = { ...raw, datasetId: 'adapter_dataset', rows: [{ amount: 'not a number' }] };
  await assert.rejects(service.query(id, { datasetId: imported.dataset.id }), /invalid evidence/);
  service.close();
});

test('HTTP expiry, session and per-session resource limits', async t => {
  let now = 1000;
  const { call } = await harness(t, { now: () => now, limits: { sessionTtlMs: 1000, maxSessions: 1, maxDatasets: 1, maxQueries: 1 } });
  const id = (await call('/api/datasets/import', upload)).body.dataset.id;
  assert.equal((await call('/api/datasets', undefined, { Cookie: '' })).status, 429);
  assert.equal((await call('/api/datasets/import', upload)).status, 429);
  const qid = (await call('/api/query', { datasetId: id })).body.result.queryId;
  assert.equal((await call('/api/query', { datasetId: id })).status, 429);
  now += 1000;
  assert.equal((await call(`/api/queries/${qid}`)).status, 401);
  assert.equal((await call('/api/datasets', undefined, { Cookie: '' })).status, 200);
  assert.equal((await call(`/api/queries/${qid}`)).status, 404);
});

test('byte budget, adapter timeout and safe internal errors', async t => {
  const small = await harness(t, { limits: { maxEvidenceBytes: 1 } });
  assert.equal((await small.call('/api/datasets/import', upload)).status, 429);
  const timeout = await harness(t, { limits: { operationTimeoutMs: 10 }, createAdapter: () => ({
    ...fixture(), importDataset: async () => new Promise(() => {}),
  }) });
  assert.equal((await timeout.call('/api/datasets/import', upload)).status, 503);
  assert.equal((await timeout.call('/api/datasets/import', upload)).status, 429);
  const failure = await harness(t, { createAdapter: () => { throw new Error('SECRET provider stack'); } });
  const response = await failure.call('/api/datasets/import', upload);
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.body).includes('SECRET'), false);
});
