import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const chartKinds = ['line', 'bar', 'area', 'scatter', 'pie', 'heatmap', 'treemap', 'sankey', 'table', 'metric'] as const;
export const chartSchema = z.object({
  id, datasetId: id, title: z.string().min(1).max(200),
  kind: z.enum(chartKinds), fields: z.array(z.string().min(1).max(100)).min(1).max(20),
  queryId: id,
}).strict();
export const dashboardSchema = z.object({
  revision: z.number().int().nonnegative(),
  charts: z.array(chartSchema).max(50), selectedChartId: id.nullable(),
}).strict();
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Chart = z.infer<typeof chartSchema>;
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), expectedRevision: z.number().int().nonnegative(), chart: chartSchema }).strict(),
  z.object({ type: z.literal('update'), expectedRevision: z.number().int().nonnegative(), chartId: id,
    patch: chartSchema.omit({ id: true, datasetId: true, queryId: true }).partial() }).strict(),
  z.object({ type: z.literal('remove'), expectedRevision: z.number().int().nonnegative(), chartId: id }).strict(),
  z.object({ type: z.literal('reorder'), expectedRevision: z.number().int().nonnegative(), chartIds: z.array(id).max(50) }).strict(),
  z.object({ type: z.literal('select'), expectedRevision: z.number().int().nonnegative(), chartId: id.nullable() }).strict(),
]);

export function applyDashboardAction(current: Dashboard, input: unknown): Dashboard {
  const state = dashboardSchema.parse(current);
  const action = actionSchema.parse(input);
  if (action.expectedRevision !== state.revision) throw new Error('Dashboard changed; refresh context before retrying.');
  const charts = state.charts.map(chart => ({ ...chart, fields: [...chart.fields] }));
  const ids = new Set(charts.map(chart => chart.id));
  if (ids.size !== charts.length) throw new Error('Duplicate chart IDs in dashboard.');
  if (state.selectedChartId && !ids.has(state.selectedChartId)) throw new Error('Invalid selected chart.');
  let selectedChartId = state.selectedChartId;
  if (action.type === 'add') {
    if (ids.has(action.chart.id)) throw new Error('Chart ID already exists.');
    charts.push(action.chart);
    selectedChartId = action.chart.id;
  } else if (action.type === 'reorder') {
    if (action.chartIds.length !== charts.length || new Set(action.chartIds).size !== charts.length || action.chartIds.some(chartId => !ids.has(chartId))) {
      throw new Error('Reordering must include every chart exactly once.');
    }
    const lookup = new Map(charts.map(chart => [chart.id, chart]));
    charts.splice(0, charts.length, ...action.chartIds.map(chartId => lookup.get(chartId)!));
  } else if (action.type === 'select') {
    if (action.chartId !== null && !ids.has(action.chartId)) throw new Error('Unknown chart.');
    selectedChartId = action.chartId;
  } else {
    const index = charts.findIndex(chart => chart.id === action.chartId);
    if (index < 0) throw new Error('Unknown chart.');
    if (action.type === 'remove') {
      charts.splice(index, 1);
      if (selectedChartId === action.chartId) selectedChartId = null;
    } else charts[index] = chartSchema.parse({ ...charts[index], ...action.patch });
  }
  return dashboardSchema.parse({ revision: state.revision + 1, charts, selectedChartId });
}
