import test from 'node:test';
import assert from 'node:assert/strict';
import type { Chart } from '../shared/dashboard.js';
import type { QueryResult } from '../shared/data.js';
import type { CanvasState } from '../src/canvas/useCanvas.js';
import { base64ToFloat, floatToInt16, int16ToBase64, Resampler } from '../src/voice/pcm.js';
import { createToolRunner, resolveChart } from '../src/voice/tools.js';

test('resampling to 16 kHz is continuous across chunk boundaries', () => {
  const input = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
  const whole = new Resampler(48000).push(input);
  const chunked: number[] = [];
  const r = new Resampler(48000);
  let offset = 0;
  for (const size of [128, 128, 500, 1, 2047, 1996]) { chunked.push(...r.push(input.subarray(offset, offset + size))); offset += size; }
  assert.equal(offset, 4800);
  assert.ok(Math.abs(whole.length - 1600) <= 1);
  assert.ok(Math.abs(chunked.length - whole.length) <= 1);
  for (let i = 0; i < Math.min(chunked.length, whole.length); i++) assert.ok(Math.abs(chunked[i]! - whole[i]!) < 1e-6, `sample ${i}`);
});

test('PCM16 base64 round trip preserves samples and clamps overload', () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]);
  const back = base64ToFloat(int16ToBase64(floatToInt16(samples)));
  assert.equal(back.length, samples.length);
  for (const [i, expected] of [0, 0.5, -0.5, 1, -1, 1, -1].entries()) assert.ok(Math.abs(back[i]! - expected) < 1e-3);
});

const chart = (id: string, title: string, kind: Chart['kind'] = 'bar'): Chart =>
  ({ id, datasetId: 'd1', title, kind, fields: ['region', 'total'], queryId: `q_${id}` });
const charts = [chart('c1', 'Revenue by region'), chart('c2', 'Revenue by month', 'line'), chart('c3', 'Accounts by region')];

test('"this chart" resolves to the selection; ambiguity asks instead of guessing', () => {
  assert.deepEqual(resolveChart('selected', charts, 'c2'), { chart: charts[1] });
  assert.match((resolveChart('this', charts, null) as { error: string }).error, /No chart is selected/);
  assert.deepEqual(resolveChart('c3', charts, null), { chart: charts[2] });
  assert.deepEqual(resolveChart('revenue by month', charts, null), { chart: charts[1] });
  assert.match((resolveChart('region', charts, null) as { error: string }).error, /could mean/);
  assert.match((resolveChart('profit', charts, null) as { error: string }).error, /No chart matches/);
});

function fakeCanvas() {
  const result: QueryResult = { queryId: 'q_c1', datasetId: 'd1', rows: [{ region: 'North', total: 250 }, { region: 'South', total: 450 }],
    capturedAt: '2026-10-03T00:00:00.000Z', filters: {}, aggregation: 'sum(revenue) by region', truncated: false };
  const log: unknown[] = [];
  let release: () => void = () => {};
  const canvas = {
    dashboard: { revision: 3, charts, selectedChartId: 'c1' },
    datasets: [{ id: 'd1', sourceId: 's', kind: 'excel', name: 'Revenue', rowCount: 4, capturedAt: result.capturedAt, freshness: 'snapshot',
      columns: [{ name: 'month', type: 'date' }, { name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] }],
    activeDataset: undefined as unknown,
    results: { q_c1: result },
    changeKind: (id: string, kind: string) => log.push(['kind', id, kind]),
    rename: (id: string, title: string) => log.push(['rename', id, title]),
    remove: (id: string) => log.push(['remove', id]),
    select: (id: string | null) => log.push(['select', id]),
    dispatch: (action: unknown) => { log.push(action); return true; },
    cancelPlans: (ids: string[]) => log.push(['cancel', ids]),
    planDashboard: (_prompt: string, requestId: string) => new Promise(resolve => {
      release = () => resolve({ ok: false, reason: `cancelled ${requestId}` });
    }),
    api: { query: async (request: unknown) => { log.push(['query', request]); return result; } },
  };
  canvas.activeDataset = canvas.datasets[0];
  return { canvas: canvas as unknown as CanvasState, log, release: () => release() };
}

test('tools act through canvas actions and report evidence', async () => {
  const { canvas, log } = fakeCanvas();
  const tools = createToolRunner(() => canvas);
  const described = await tools.run({ id: '1', name: 'describe_chart', args: { chart: 'this' } });
  assert.deepEqual((described as { rows: unknown[] }).rows, [{ region: 'North', total: 250 }, { region: 'South', total: 450 }]);
  const changed = await tools.run({ id: '2', name: 'change_chart', args: { chart: 'selected', kind: 'metric' } });
  assert.match(String((changed as { warning?: string }).warning), /one value.*query was not changed/);
  assert.deepEqual(log[0], ['kind', 'c1', 'metric']);
  await tools.run({ id: '3', name: 'reorder_charts', args: { order: ['Revenue by month'] } });
  assert.deepEqual(log[1], { type: 'reorder', chartIds: ['c2', 'c1', 'c3'] });
  const removed = await tools.run({ id: '4', name: 'remove_charts', args: { charts: ['region'] } });
  assert.match(String((removed as { error?: string }).error), /could mean/);
  await tools.run({ id: '5', name: 'query_data', args: { group_by: ['region'], measure: 'revenue', aggregate: 'sum', filter_field: 'month', filter_value: '2026-08' } });
  const query = (log.at(-1) as [string, { filters: unknown[] }])[1];
  assert.deepEqual(query.filters, [{ field: 'month', op: 'eq', value: { type: 'date', value: '2026-08-01T00:00:00.000Z' } }]);
  assert.match(String((await tools.run({ id: '6', name: 'add_chart', args: { kind: 'radar' } })).error), /Unknown chart type/);
});

test('a cancelled build_dashboard call cancels its planning request', async () => {
  const { canvas, log, release } = fakeCanvas();
  const tools = createToolRunner(() => canvas);
  const pending = tools.run({ id: 'call/42', name: 'build_dashboard', args: { request: 'revenue by month' } });
  await new Promise(r => setTimeout(r, 0));
  tools.cancel(['call/42', 'unknown']);
  assert.deepEqual(log, [['cancel', ['voice_call42']]]);
  release();
  assert.deepEqual(await pending, { error: 'cancelled voice_call42' });
});
