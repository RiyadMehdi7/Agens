import type { Chart } from '../../shared/dashboard.js';
import type { QueryResult } from '../../shared/data.js';
import type { Aggregate, ChartDraft } from '../../shared/plan.js';
import { chartKinds } from '../../shared/dashboard.js';
import { checkChart } from '../canvas/registry.js';
import type { CanvasState } from '../canvas/useCanvas.js';
import type { ToolCall } from './session.js';

type Result = Record<string, unknown>;
const ops = ['sum', 'avg', 'count', 'min', 'max'] as const;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.trim()) : []);
const op = (v: unknown, fallback: Aggregate): Aggregate => (ops as readonly string[]).includes(String(v)) ? (v as Aggregate) : fallback;

/** Resolve "selected", an id or a title to one chart, or explain why it is ambiguous. */
export function resolveChart(ref: unknown, charts: Chart[], selectedId: string | null): { chart: Chart } | { error: string } {
  const value = str(ref)?.toLowerCase() ?? 'selected';
  if (['selected', 'this', 'it', 'this chart', 'that', 'that one'].includes(value)) {
    const chart = charts.find(c => c.id === selectedId);
    return chart ? { chart } : { error: 'No chart is selected. Ask the user which chart they mean.' };
  }
  const exact = charts.filter(c => c.id.toLowerCase() === value || c.title.toLowerCase() === value);
  if (exact.length === 1) return { chart: exact[0]! };
  const partial = charts.filter(c => c.title.toLowerCase().includes(value));
  if (partial.length === 1) return { chart: partial[0]! };
  if (!partial.length) return { error: `No chart matches "${ref}". Charts: ${charts.map(c => c.title).join('; ') || 'none'}.` };
  return { error: `"${ref}" could mean ${partial.map(c => `"${c.title}"`).join(' or ')}. Ask which one.` };
}

function evidence(chart: Chart, result: QueryResult | undefined, maxRows: number): Result {
  if (!result) return { id: chart.id, title: chart.title, kind: chart.kind, error: 'Evidence not loaded.' };
  return {
    id: chart.id, title: chart.title, kind: chart.kind, fields: chart.fields, aggregation: result.aggregation,
    capturedAt: result.capturedAt, truncated: result.truncated, rowCount: result.rows.length,
    rows: result.rows.slice(0, maxRows), moreRows: Math.max(0, result.rows.length - maxRows),
  };
}

function typed(value: string, type: string | undefined) {
  if (type === 'number' && Number.isFinite(Number(value))) return { type: 'number' as const, value: Number(value) };
  if (type === 'boolean' && /^(true|false)$/i.test(value)) return { type: 'boolean' as const, value: /^true$/i.test(value) };
  if (type === 'date') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return { type: 'date' as const, value: date.toISOString() };
  }
  return { type: 'string' as const, value };
}

/**
 * Executes Live tool calls against the canvas. `get` returns the latest canvas state, because tool
 * results arrive asynchronously. Every change goes through the same validated actions as the manual
 * controls, and every number returned comes from stored query evidence.
 */
export function createToolRunner(get: () => CanvasState) {
  const callToRequest = new Map<string, string>();

  async function run(call: ToolCall): Promise<Result> {
    const canvas = get();
    const { charts, selectedChartId } = canvas.dashboard;
    const a = call.args;
    switch (call.name) {
      case 'list_data':
        return {
          activeDatasetId: canvas.activeDataset?.id ?? null,
          datasets: canvas.datasets.map(d => ({ id: d.id, name: d.name, freshness: d.freshness, rows: d.rowCount,
            columns: d.columns.map(c => `${c.name}:${c.type}`) })),
          charts: charts.map(c => ({ id: c.id, title: c.title, kind: c.kind })), selectedChartId,
        };
      case 'build_dashboard': {
        const request = str(a.request);
        if (!request) return { error: 'Say what the dashboard should show.' };
        const requestId = `voice_${call.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || Date.now().toString(36)}`;
        callToRequest.set(call.id, requestId);
        const outcome = await get().planDashboard(request, requestId);
        callToRequest.delete(call.id);
        if (!outcome.ok) return { error: outcome.reason };
        return {
          summary: outcome.summary, skipped: outcome.skipped,
          added: outcome.added.map((chart, i) => evidence(chart, outcome.results[i], 8)),
        };
      }
      case 'add_chart': {
        const kind = str(a.kind);
        if (!kind || !(chartKinds as readonly string[]).includes(kind)) return { error: 'Unknown chart type.' };
        const measure = str(a.measure);
        const draft: ChartDraft = { kind: kind as Chart['kind'], dimension: str(a.dimension), dimension2: str(a.second_dimension),
          measure, op: op(a.aggregate, measure ? 'sum' : 'count'), x: str(a.x), y: str(a.y), columns: strs(a.columns) };
        const outcome = await canvas.addChart(draft);
        return outcome.ok ? { added: evidence(outcome.chart, outcome.result, 12) } : { error: outcome.reason };
      }
      case 'change_chart': {
        const found = resolveChart(a.chart, charts, selectedChartId);
        if ('error' in found) return found;
        const kind = str(a.kind);
        const title = str(a.title);
        if (kind) {
          if (!(chartKinds as readonly string[]).includes(kind)) return { error: 'Unknown chart type.' };
          canvas.changeKind(found.chart.id, kind as Chart['kind']);
        }
        if (title) canvas.rename(found.chart.id, title);
        const result = canvas.results[found.chart.queryId];
        const check = kind && result ? checkChart({ kind: kind as Chart['kind'], fields: found.chart.fields }, result) : undefined;
        return { changed: found.chart.id, kind: kind ?? found.chart.kind, title: title ?? found.chart.title,
          ...(check && !check.ok ? { warning: `${check.reason} The query was not changed.` } : {}) };
      }
      case 'remove_charts': {
        const refs = strs(a.charts);
        const targets: Chart[] = [];
        for (const ref of refs.length ? refs : ['selected']) {
          const found = resolveChart(ref, charts, selectedChartId);
          if ('error' in found) return found;
          targets.push(found.chart);
        }
        targets.forEach(chart => canvas.remove(chart.id));
        return { removed: targets.map(c => c.title) };
      }
      case 'reorder_charts': {
        const first: string[] = [];
        for (const ref of strs(a.order)) {
          const found = resolveChart(ref, charts, selectedChartId);
          if ('error' in found) return found;
          if (!first.includes(found.chart.id)) first.push(found.chart.id);
        }
        const order = [...first, ...charts.map(c => c.id).filter(id => !first.includes(id))];
        return canvas.dispatch({ type: 'reorder', chartIds: order })
          ? { order: order.map(id => charts.find(c => c.id === id)!.title) } : { error: 'The dashboard changed; try again.' };
      }
      case 'select_chart': {
        if (str(a.chart)?.toLowerCase() === 'none') { canvas.select(null); return { selected: null }; }
        const found = resolveChart(a.chart, charts, null);
        if ('error' in found) return found;
        canvas.select(found.chart.id);
        return { selected: found.chart.title };
      }
      case 'describe_chart': {
        const found = resolveChart(a.chart, charts, selectedChartId);
        if ('error' in found) return found;
        const dataset = canvas.datasets.find(d => d.id === found.chart.datasetId);
        return { ...evidence(found.chart, canvas.results[found.chart.queryId], 60), dataset: dataset?.name, freshness: dataset?.freshness };
      }
      case 'query_data': {
        const dataset = canvas.activeDataset;
        if (!dataset) return { error: 'No data is connected.' };
        const types = new Map(dataset.columns.map(c => [c.name, c.type]));
        const groupBy = strs(a.group_by).slice(0, 2);
        const measure = str(a.measure);
        const aggregate = op(a.aggregate, measure ? 'sum' : 'count');
        const alias = groupBy.includes('result') ? 'result_value' : 'result';
        const filterField = str(a.filter_field), filterValue = str(a.filter_value);
        try {
          const result = await canvas.api.query({
            datasetId: dataset.id,
            ...(groupBy.length ? { groupBy } : {}),
            aggregates: [{ op: aggregate, ...(aggregate !== 'count' || measure ? { field: measure } : {}), alias }],
            filters: filterField && filterValue !== undefined ? [{ field: filterField, op: 'eq', value: typed(filterValue, types.get(filterField)) }] : [],
            sort: groupBy.map(field => ({ field, direction: 'asc' as const })),
            limit: 200,
          });
          return { aggregation: result.aggregation, capturedAt: result.capturedAt, truncated: result.truncated, rows: result.rows.slice(0, 120) };
        } catch (error) {
          return { error: (error as Error).message || 'The query could not run.' };
        }
      }
      default:
        return { error: `Unknown tool ${call.name}.` };
    }
  }

  return {
    async run(call: ToolCall): Promise<Result> {
      try { return await run(call); } catch { return { error: 'That action failed. Try again.' }; }
    },
    /** Map Live tool-call cancellations onto planning requests so their late results are discarded. */
    cancel(callIds: string[]) {
      const requests = callIds.map(id => callToRequest.get(id)).filter((id): id is string => !!id);
      if (requests.length) get().cancelPlans(requests);
    },
  };
}
