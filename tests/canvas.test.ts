import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDashboardAction, type Chart, type Dashboard } from '../shared/dashboard.js';
import { validateQueryForDataset, type QueryResult } from '../shared/data.js';
import { evaluateSample, sampleDataset, sampleRows } from '../src/api/sample.js';
import { planChart } from '../src/canvas/plan.js';
import { checkChart, unsupportedKinds } from '../src/canvas/registry.js';
import { formatCell } from '../src/canvas/format.js';
import { barSpans } from '../src/canvas/geometry.js';

const run = (input: ReturnType<typeof planChart>['request']): QueryResult =>
  ({ queryId: 'q1', ...evaluateSample(sampleDataset, sampleRows(), validateQueryForDataset(input, sampleDataset)) });

test('sample fixture has known monthly and regional totals', () => {
  const monthly = run(planChart({ kind: 'line', dimension: 'month', measure: 'revenue', op: 'sum' }, sampleDataset).request);
  const totals = monthly.rows.map(r => r.sum_revenue);
  assert.equal(totals.length, 9);
  assert.equal(monthly.rows[0]?.month, '2026-01-01T00:00:00.000Z');
  const regional = run(planChart({ kind: 'bar', dimension: 'region', measure: 'revenue', op: 'sum' }, sampleDataset).request);
  assert.deepEqual(regional.rows.map(r => r.region), ['North America', 'Europe', 'APAC', 'LATAM']);
  const sum = (rows: QueryResult['rows'], f: string) => rows.reduce((a, r) => a + (r[f] as number), 0);
  const grand = run(planChart({ kind: 'metric', measure: 'revenue', op: 'sum' }, sampleDataset).request);
  assert.equal(grand.rows[0]?.sum_revenue, sum(monthly.rows, 'sum_revenue'));
  assert.equal(grand.rows[0]?.sum_revenue, sum(regional.rows, 'sum_revenue'));
  assert.equal(grand.rows[0]?.sum_revenue, 4_312_000);
});

test('planned queries pass the shared dataset validation', () => {
  for (const draft of [
    { kind: 'line', dimension: 'month', measure: 'revenue', op: 'avg' },
    { kind: 'bar', dimension: 'region', op: 'count' },
    { kind: 'metric', measure: 'accounts', op: 'max' },
    { kind: 'table', op: 'sum', columns: ['region', 'revenue', 'nope'] },
  ] as const) {
    const planned = planChart(draft, sampleDataset);
    assert.doesNotThrow(() => validateQueryForDataset(planned.request, sampleDataset));
  }
  assert.throws(() => planChart({ kind: 'line', dimension: 'missing', measure: 'revenue', op: 'sum' }, sampleDataset), /category/);
  assert.throws(() => planChart({ kind: 'metric', measure: 'region', op: 'sum' }, sampleDataset), /not numeric/);
  assert.throws(() => planChart({ kind: 'table', op: 'sum', columns: [] }, sampleDataset), /column/);
});

test('aggregate alias never collides with the grouped field', () => {
  const dataset = { ...sampleDataset, columns: [...sampleDataset.columns, { name: 'sum_revenue', type: 'string' as const }] };
  const planned = planChart({ kind: 'bar', dimension: 'sum_revenue', measure: 'revenue', op: 'sum' }, dataset);
  assert.deepEqual(planned.fields, ['sum_revenue', 'sum_revenue_2']);
});

test('renderer registry validates actual evidence and stays explicit about unsupported kinds', () => {
  const series = run(planChart({ kind: 'line', dimension: 'month', measure: 'revenue', op: 'sum' }, sampleDataset).request);
  const fields = ['month', 'sum_revenue'];
  const line = checkChart({ kind: 'line', fields }, series);
  assert.ok(line.ok && line.data.kind === 'line' && line.data.xIsDate && line.data.points.length === 9);
  assert.ok(checkChart({ kind: 'bar', fields }, series).ok);
  assert.ok(checkChart({ kind: 'table', fields }, series).ok);
  const metric = checkChart({ kind: 'metric', fields }, series);
  assert.ok(!metric.ok && /9 rows/.test(metric.reason));
  const missing = checkChart({ kind: 'line', fields: ['month', 'profit'] }, series);
  assert.ok(!missing.ok && /profit/.test(missing.reason));
  const text = checkChart({ kind: 'bar', fields: ['sum_revenue', 'month'] }, series);
  assert.ok(!text.ok && /not numeric/.test(text.reason));
  for (const kind of unsupportedKinds) assert.ok(!checkChart({ kind, fields }, series).ok);
  assert.deepEqual(unsupportedKinds, ['area', 'scatter', 'pie', 'heatmap', 'treemap', 'sankey']);
  const empty = checkChart({ kind: 'bar', fields }, { ...series, rows: [] });
  assert.ok(empty.ok && empty.empty);
});

test('truncation is reported by the fixture when the limit cuts rows', () => {
  const planned = planChart({ kind: 'table', op: 'sum', columns: ['month', 'region', 'revenue'] }, sampleDataset);
  const result = run({ ...planned.request, limit: 10 });
  assert.equal(result.rows.length, 10);
  assert.equal(result.truncated, true);
});

test('manual controls use the shared reducer: type change keeps query, reorder is complete', () => {
  const chart = (id: string, kind: Chart['kind']): Chart =>
    ({ id, datasetId: 'sample_revenue', title: id, kind, fields: ['month', 'sum_revenue'], queryId: `q_${id}` });
  let state: Dashboard = { revision: 0, charts: [], selectedChartId: null };
  const act = (action: object) => { state = applyDashboardAction(state, { ...action, expectedRevision: state.revision }); };
  act({ type: 'add', chart: chart('a', 'line') });
  act({ type: 'add', chart: chart('b', 'bar') });
  act({ type: 'add', chart: chart('c', 'table') });
  act({ type: 'update', chartId: 'a', patch: { kind: 'bar' } });
  assert.equal(state.charts[0]?.queryId, 'q_a');
  assert.deepEqual(state.charts[0]?.fields, ['month', 'sum_revenue']);
  act({ type: 'reorder', chartIds: ['c', 'a', 'b'] });
  assert.deepEqual(state.charts.map(c => c.id), ['c', 'a', 'b']);
  assert.throws(() => act({ type: 'reorder', chartIds: ['c', 'a'] }));
  act({ type: 'select', chartId: 'a' });
  act({ type: 'remove', chartId: 'a' });
  assert.equal(state.selectedChartId, null);
  assert.throws(() => applyDashboardAction(state, { type: 'select', chartId: 'b', expectedRevision: state.revision - 1 }), /changed/);
});

test('cells format without inventing values', () => {
  assert.equal(formatCell(null), '—');
  assert.equal(formatCell('2026-08-01T00:00:00.000Z'), 'Aug 26');
  assert.equal(formatCell(1234.5, false), '1,234.5');
  assert.equal(formatCell(1_553_000), '1.6M');
});

test('bars use a signed scale with a shared zero baseline', () => {
  const positive = barSpans([10, 5, null]);
  assert.equal(positive.zero, 0);
  assert.deepEqual(positive.spans[0], { left: 0, width: 100, negative: false });
  assert.equal(positive.spans[1]?.width, 50);
  assert.equal(positive.spans[2], null);
  const negative = barSpans([-4, -2]);
  assert.equal(negative.zero, 100);
  assert.deepEqual(negative.spans[0], { left: 0, width: 100, negative: true });
  assert.deepEqual(negative.spans[1], { left: 50, width: 50, negative: true });
  const mixed = barSpans([-25, 75]);
  assert.equal(mixed.zero, 25);
  assert.deepEqual(mixed.spans[0], { left: 0, width: 25, negative: true });
  assert.deepEqual(mixed.spans[1], { left: 25, width: 75, negative: false });
  assert.equal(barSpans([0, 0]).spans[0]?.width, 0);
});
