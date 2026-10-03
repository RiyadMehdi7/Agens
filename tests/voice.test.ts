import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbookAdapter } from '../server/data/adapter.js';
import { ApiError, ApiService } from '../server/http/service.js';
import { ProviderError, type VoiceProvider } from '../server/voice/provider.js';
import { liveConnectConfig, liveModel, liveTools, plannerOutputSchema, type PlannerOutput } from '../shared/voice.js';
import { healthResponseSchema } from '../shared/api.js';

const csv = 'month,region,revenue\n2026-01-01,North,100\n2026-01-01,South,200\n2026-02-01,North,150\n2026-02-01,South,250\n';
const empty = { revision: 0, charts: [], selectedChartId: null };

function fake(plan: (datasetId: string) => PlannerOutput | Error, token: () => Promise<string> = async () => 'auth_tokens/fake') {
  const calls: { prompt: string; columns: string[] }[] = [];
  const voice: VoiceProvider = {
    async createLiveToken() {
      return { token: await token(), model: liveModel, expiresAt: new Date().toISOString(), newSessionExpiresAt: new Date().toISOString() };
    },
    async plan(input) {
      calls.push({ prompt: input.prompt, columns: input.datasets.flatMap(d => d.columns.map(c => c.name)) });
      const out = plan(input.datasets[0]!.id);
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { voice, calls };
}

async function session(voice?: VoiceProvider) {
  const service = new ApiService({ createAdapter: createWorkbookAdapter, dataImplemented: true, voice });
  const id = service.session().id;
  const { dataset } = await service.import(id, { format: 'csv', name: 'Revenue', contentBase64: Buffer.from(csv).toString('base64') });
  return { service, id, dataset };
}

const status = async (promise: Promise<unknown>) => {
  try { await promise; return 'ok'; } catch (error) { return error instanceof ApiError ? `${error.status} ${error.code}` : 'other'; }
};

test('health reports voice and planner only when a provider is configured', () => {
  const off = healthResponseSchema.parse(new ApiService({}).health());
  assert.equal(off.availability.voice, 'unavailable');
  assert.equal(off.voiceImplemented, false);
  const on = healthResponseSchema.parse(new ApiService({ voice: fake(() => ({ charts: [], summary: '' })).voice }).health());
  assert.deepEqual([on.availability.voice, on.availability.planner, on.voiceImplemented], ['configured', 'configured', true]);
});

test('live tokens come from the provider; quota and outages map to safe errors', async () => {
  let mode: 'ok' | 'quota' | 'down' = 'ok';
  const { voice } = fake(() => ({ charts: [], summary: '' }), async () => {
    if (mode === 'quota') throw new ProviderError('quota');
    if (mode === 'down') throw new Error('provider stack trace with secrets');
    return 'auth_tokens/abc';
  });
  const service = new ApiService({ voice });
  const id = service.session().id;
  assert.deepEqual((await service.live(id)).token, 'auth_tokens/abc');
  mode = 'quota';
  assert.equal(await status(service.live(id)), '429 RESOURCE_LIMIT');
  mode = 'down';
  try { await service.live(id); assert.fail(); } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /secret|stack/);
  }
  const off = new ApiService({});
  assert.equal(await status(off.live(off.session().id)), '503 NOT_IMPLEMENTED');
});

test('planner drafts are validated against the real schema and backed by stored evidence', async () => {
  const { voice, calls } = fake(datasetId => ({
    summary: 'Monthly and regional revenue.',
    charts: [
      { datasetId, kind: 'line', title: 'Revenue by month', dimension: 'month', measure: 'revenue', op: 'sum' },
      { datasetId, kind: 'bar', dimension: 'region', measure: 'revenue', op: 'sum' },
      { datasetId, kind: 'bar', dimension: 'country', measure: 'revenue', op: 'sum' },
      { datasetId: 'not_owned', kind: 'metric', measure: 'revenue', op: 'sum' },
    ],
  }));
  const { service, id, dataset } = await session(voice);
  const plan = await service.plan(id, { requestId: 'req_1', prompt: 'Revenue by month and region', dashboard: empty, evidence: [] });
  assert.equal(plan.requestId, 'req_1');
  assert.deepEqual(calls[0], { prompt: 'Revenue by month and region', columns: ['month', 'region', 'revenue'] });
  assert.deepEqual(plan.charts.map(c => [c.chart.title, c.chart.kind, c.chart.fields]),
    [['Revenue by month', 'line', ['month', 'sum_revenue']], ['Total revenue by region', 'bar', ['region', 'sum_revenue']]]);
  assert.deepEqual(plan.charts[0]!.result.rows.map(r => r.sum_revenue), [300, 400]);
  assert.deepEqual(plan.charts[1]!.result.rows, [{ region: 'South', sum_revenue: 450 }, { region: 'North', sum_revenue: 250 }]);
  for (const { chart } of plan.charts) {
    assert.equal(chart.datasetId, dataset.id);
    assert.equal(service.evidence(id, chart.queryId, chart.datasetId).result.queryId, chart.queryId);
  }
  assert.equal(plan.skipped.length, 2);
  assert.match(plan.skipped.join(' '), /category/);
  assert.match(plan.skipped.join(' '), /not connected/);
});

test('planner failures and missing data are reported, never turned into charts', async () => {
  const broken = fake(() => new ProviderError('invalid-output'));
  const a = await session(broken.voice);
  assert.equal(await status(a.service.plan(a.id, { prompt: 'x', dashboard: empty, evidence: [] })), '503 UNAVAILABLE');
  const quota = fake(() => new ProviderError('quota'));
  const b = await session(quota.voice);
  assert.equal(await status(b.service.plan(b.id, { prompt: 'x', dashboard: empty, evidence: [] })), '429 RESOURCE_LIMIT');
  const noData = new ApiService({ createAdapter: createWorkbookAdapter, voice: fake(() => ({ charts: [], summary: '' })).voice });
  assert.equal(await status(noData.plan(noData.session().id, { prompt: 'x', dashboard: empty, evidence: [] })), '400 INVALID_REQUEST');
  const off = await session();
  assert.equal(await status(off.service.plan(off.id, { prompt: 'x', dashboard: empty, evidence: [] })), '503 NOT_IMPLEMENTED');
});

test('the Live config locks the 3.8 model, audio output and non-blocking tools without unsupported thinking config', () => {
  const config = liveConnectConfig();
  assert.equal(liveModel, 'gemini-3.8-live');
  assert.deepEqual(config.responseModalities, ['AUDIO']);
  assert.ok(!('thinkingConfig' in config));
  const declared = config.tools[0]!.functionDeclarations;
  assert.deepEqual(declared.map(d => d.name), liveTools.map(t => t.name));
  assert.ok(declared.every(d => d.behavior === 'NON_BLOCKING'));
  assert.ok(plannerOutputSchema.safeParse({ charts: [{ datasetId: 'a', kind: 'sankey', op: 'sum', extra: 1 }], summary: '' }).success === false);
});

test('a slow plan outlives the ordinary idle socket timeout', async t => {
  const { createApiServer } = await import('../server/http/router.js');
  const net = await import('node:net');
  const holder = net.createServer();
  await new Promise<void>(r => holder.listen(0, '127.0.0.1', r));
  const port = (holder.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(r => holder.close(() => r()));
  const origin = `http://127.0.0.1:${port}`;
  const slow: VoiceProvider = { ...fake(() => ({ charts: [], summary: '' })).voice,
    async plan() { await new Promise(r => setTimeout(r, 600)); return { charts: [], summary: 'late but fine' }; } };
  const { server } = createApiServer({ origin, createAdapter: createWorkbookAdapter, voice: slow, idleTimeoutMs: 200 });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  let cookie = '';
  const post = async (path: string, body: unknown) => {
    const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return response;
  };
  assert.equal((await post('/api/datasets/import', { format: 'csv', name: 'R', contentBase64: Buffer.from(csv).toString('base64') })).status, 201);
  const plan = await post('/api/dashboard/plan', { prompt: 'x', dashboard: empty, evidence: [] });
  assert.equal(plan.status, 200);
  assert.equal((await plan.json() as { summary: string }).summary, 'late but fine');
});
