import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDashboardAction, type Dashboard } from '../shared/dashboard.js';
import { getConfig } from '../server/config.js';
const state: Dashboard = { revision: 3, selectedChartId: 'revenue', charts: [
  { id: 'revenue', datasetId: 'excel_1', queryId: 'filtered_q1', title: 'Revenue', kind: 'bar', fields: ['month', 'revenue'] },
  { id: 'regions', datasetId: 'excel_1', queryId: 'regions_q', title: 'Regions', kind: 'table', fields: ['region'] },
] };
test('chart type change retains filtered query without mutating source', () => {
  const next = applyDashboardAction(state, { type: 'update', expectedRevision: 3, chartId: 'revenue', patch: { kind: 'line' } });
  assert.equal(next.charts[0]?.queryId, 'filtered_q1');
  assert.equal(next.charts[0]?.datasetId, 'excel_1');
  assert.equal(next.charts[0]?.kind, 'line');
  assert.equal(state.charts[0]?.kind, 'bar');
});
test('stale asynchronous work cannot overwrite a newer dashboard', () => {
  assert.throws(() => applyDashboardAction(state, { type: 'remove', expectedRevision: 2, chartId: 'revenue' }), /Dashboard changed/);
});
test('remove resolves a stable ID and clears selection', () => {
  const next = applyDashboardAction(state, { type: 'remove', expectedRevision: 3, chartId: 'revenue' });
  assert.equal(next.selectedChartId, null);
  assert.deepEqual(next.charts.map(c => c.id), ['regions']);
});
test('reorder rejects duplicates, missing and invented IDs', () => {
  for (const chartIds of [['revenue', 'revenue'], ['revenue'], ['revenue', 'unknown']]) {
    assert.throws(() => applyDashboardAction(state, { type: 'reorder', expectedRevision: 3, chartIds }));
  }
  const next = applyDashboardAction(state, { type: 'reorder', expectedRevision: 3, chartIds: ['regions', 'revenue'] });
  assert.deepEqual(next.charts.map(c => c.id), ['regions', 'revenue']);
});
test('style patches cannot replace query references; selection must exist', () => {
  assert.throws(() => applyDashboardAction(state, { type: 'update', expectedRevision: 3, chartId: 'revenue', patch: { queryId: 'other' } }));
  assert.throws(() => applyDashboardAction(state, { type: 'select', expectedRevision: 3, chartId: 'unknown' }));
});
test('older model substitution and invalid ports are rejected', () => {
  assert.equal(getConfig({}).liveModel, 'gemini-3.8-live');
  assert.throws(() => getConfig({ GEMINI_LIVE_MODEL: 'gemini-2.5-flash' }));
  assert.throws(() => getConfig({ PORT: 'NaN' }));
});
