import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDashboardAction, type Chart, type Dashboard } from '../shared/dashboard.js';
import { validateQueryForDataset, type QueryResult } from '../shared/data.js';
import { evaluateSample, sampleDataset, sampleRows } from '../src/api/sample.js';
import { planChart } from '../src/canvas/plan.js';
import { checkChart, unsupportedKinds } from '../src/canvas/registry.js';
import { formatCell } from '../src/canvas/format.js';
import { barSpans, pieArcs, sankeyLayout, squarify } from '../src/canvas/geometry.js';

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
  assert.deepEqual(unsupportedKinds, []);
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

test('every shared chart kind plans a valid query and renders from the fixture', () => {
  const drafts = [
    { kind: 'line', dimension: 'month', measure: 'revenue', op: 'sum' },
    { kind: 'area', dimension: 'month', measure: 'revenue', op: 'sum' },
    { kind: 'bar', dimension: 'region', measure: 'revenue', op: 'sum' },
    { kind: 'pie', dimension: 'region', measure: 'revenue', op: 'sum' },
    { kind: 'treemap', dimension: 'region', measure: 'accounts', op: 'sum' },
    { kind: 'metric', measure: 'revenue', op: 'avg' },
    { kind: 'scatter', op: 'sum', x: 'accounts', y: 'revenue' },
    { kind: 'heatmap', dimension: 'region', dimension2: 'month', measure: 'revenue', op: 'sum' },
    { kind: 'sankey', dimension: 'region', dimension2: 'month', measure: 'revenue', op: 'sum' },
    { kind: 'table', op: 'sum', columns: ['region', 'revenue'] },
  ] as const;
  for (const draft of drafts) {
    const planned = planChart(draft, sampleDataset);
    const result = run(planned.request);
    const check = checkChart({ kind: draft.kind, fields: planned.fields }, result);
    assert.ok(check.ok && !check.empty, `${draft.kind}: ${check.ok ? 'empty' : check.reason}`);
    assert.equal(check.data.kind, draft.kind);
  }
  const heat = checkChart({ kind: 'heatmap', fields: planChart(drafts[7], sampleDataset).fields }, run(planChart(drafts[7], sampleDataset).request));
  assert.ok(heat.ok && heat.data.kind === 'heatmap' && heat.data.rows.length === 4 && heat.data.cols.length === 9);
  assert.throws(() => planChart({ kind: 'scatter', op: 'sum', x: 'region', y: 'revenue' }, sampleDataset), /numeric/);
  assert.throws(() => planChart({ kind: 'sankey', dimension: 'region', dimension2: 'region', op: 'count' }, sampleDataset), /different/);
});

test('part-of-whole charts refuse negative values and too many slices', () => {
  const base = run(planChart({ kind: 'bar', dimension: 'region', measure: 'revenue', op: 'sum' }, sampleDataset).request);
  const negative = { ...base, rows: base.rows.map((r, i) => ({ ...r, sum_revenue: i === 0 ? -5 : r.sum_revenue ?? null })) };
  for (const kind of ['pie', 'treemap'] as const) {
    const check = checkChart({ kind, fields: ['region', 'sum_revenue'] }, negative);
    assert.ok(!check.ok && /negative/.test(check.reason));
  }
  const many = { ...base, rows: Array.from({ length: 13 }, (_, i) => ({ region: `r${i}`, sum_revenue: i + 1 })) };
  const pie = checkChart({ kind: 'pie', fields: ['region', 'sum_revenue'] }, many);
  assert.ok(!pie.ok && /too many/.test(pie.reason));
  assert.ok(checkChart({ kind: 'bar', fields: ['region', 'sum_revenue'] }, many).ok);
});

test('treemap, donut and sankey layouts conserve their totals', () => {
  const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 60, h: 40 });
  const area = rects.reduce((a, r) => a + r.w * r.h, 0);
  assert.ok(Math.abs(area - 2400) < 1e-6);
  for (const r of rects) assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 60 + 1e-9 && r.y + r.h <= 40 + 1e-9);
  assert.ok(Math.abs(rects[0]!.w * rects[0]!.h - 600) < 1e-6);
  assert.deepEqual(squarify([0, 0]).map(r => r.w), [0, 0]);
  const arcs = pieArcs([1, 1, 2]);
  assert.deepEqual(arcs.map(a => a.length), [0.25, 0.25, 0.5]);
  assert.equal(arcs[2]!.start, 0.5);
  const sk = sankeyLayout([{ source: 'A', target: 'X', value: 30 }, { source: 'A', target: 'Y', value: 10 }, { source: 'B', target: 'X', value: 60 }], 0);
  assert.deepEqual(sk.left.map(n => [n.name, n.h]), [['A', 40], ['B', 60]]);
  assert.deepEqual(sk.right.map(n => [n.name, n.h]), [['X', 90], ['Y', 10]]);
  assert.deepEqual(sk.links.map(l => [l.sy, l.sh, l.ty, l.th]), [[0, 30, 0, 30], [30, 10, 90, 10], [40, 60, 30, 60]]);
});
