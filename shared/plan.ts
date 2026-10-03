// Shared by the canvas (manual + voice tools) and the server-side planner, so both validate drafts identically.
import type { z } from 'zod';
import type { Chart } from './dashboard.js';
import type { Dataset, queryRequestSchema } from './data.js';

export type QueryInput = z.input<typeof queryRequestSchema>;

export type Aggregate = 'sum' | 'avg' | 'count' | 'min' | 'max';
export interface ChartDraft {
  kind: Chart['kind'];
  dimension?: string;
  /** Second category: heatmap columns or sankey targets. */
  dimension2?: string;
  measure?: string;
  /** Scatter axes. */
  x?: string;
  y?: string;
  op: Aggregate;
  columns?: readonly string[];
}
export interface PlannedChart { request: QueryInput; fields: string[]; title: string }

const opWords: Record<Aggregate, string> = { sum: 'Total', avg: 'Average', count: 'Count of rows', min: 'Minimum', max: 'Maximum' };

function alias(op: Aggregate, measure: string | undefined, taken: string[]): string {
  const base = (`${op}_${measure ?? 'rows'}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '').slice(0, 60) || op;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`;
  return name;
}

function measureTitle(op: Aggregate, measure?: string): string {
  return op === 'count' ? opWords.count : `${opWords[op]} ${measure}`;
}

/**
 * Turn a manual chart request into a bounded declarative query. Throws a readable message when
 * the draft does not fit the dataset. Manual controls, voice tools and the server planner all use it.
 */
export function planChart(draft: ChartDraft, dataset: Dataset, requestId?: string): PlannedChart {
  const types = new Map(dataset.columns.map(c => [c.name, c.type]));
  const need = (field: string | undefined, label: string) => {
    if (!field || !types.has(field)) throw new Error(`Choose a ${label} column.`);
    return field;
  };
  const base = { datasetId: dataset.id, ...(requestId ? { requestId } : {}) };
  if (draft.kind === 'table') {
    const columns = (draft.columns ?? []).filter(c => types.has(c)).slice(0, 8);
    if (!columns.length) throw new Error('Choose at least one column.');
    return { request: { ...base, projection: columns, limit: 50 }, fields: columns, title: columns.join(', ') };
  }
  if (draft.kind === 'scatter') {
    const x = need(draft.x, 'horizontal');
    const y = need(draft.y, 'vertical');
    if (types.get(x) !== 'number' || types.get(y) !== 'number') throw new Error('A scatter plot needs two numeric columns.');
    if (x === y) throw new Error('Choose two different columns.');
    return { request: { ...base, projection: [x, y], limit: 1000 }, fields: [x, y], title: `${y} vs ${x}` };
  }
  const measure = draft.op === 'count' ? undefined : need(draft.measure, 'number');
  if (measure && ['sum', 'avg'].includes(draft.op) && types.get(measure) !== 'number') {
    throw new Error(`"${measure}" is not numeric, so it cannot be summed or averaged.`);
  }
  const aggregate = (taken: string[]) => {
    const name = alias(draft.op, measure, taken);
    return { name, spec: { op: draft.op, ...(measure ? { field: measure } : {}), alias: name } };
  };
  if (draft.kind === 'metric') {
    const { name, spec } = aggregate([]);
    return { request: { ...base, aggregates: [spec], limit: 1 }, fields: [name], title: measureTitle(draft.op, measure) };
  }
  const dimension = need(draft.dimension, 'category');
  if (draft.kind === 'heatmap' || draft.kind === 'sankey') {
    const second = need(draft.dimension2, 'second category');
    if (second === dimension) throw new Error('Choose two different categories.');
    const { name, spec } = aggregate([dimension, second]);
    const sort = draft.kind === 'heatmap'
      ? [{ field: dimension, direction: 'asc' as const }, { field: second, direction: 'asc' as const }]
      : [{ field: name, direction: 'desc' as const }];
    return {
      request: { ...base, groupBy: [dimension, second], aggregates: [spec], sort, limit: 1000 },
      fields: [dimension, second, name],
      title: draft.kind === 'heatmap' ? `${measureTitle(draft.op, measure)} by ${dimension} and ${second}`
        : `${measureTitle(draft.op, measure)} from ${dimension} to ${second}`,
    };
  }
  const { name, spec } = aggregate([dimension]);
  // Time-like series read left to right; part-of-whole and ranking views lead with the largest value.
  const ordered = draft.kind === 'line' || draft.kind === 'area';
  const sort = ordered ? [{ field: dimension, direction: 'asc' as const }] : [{ field: name, direction: 'desc' as const }];
  return {
    request: { ...base, groupBy: [dimension], aggregates: [spec], sort, limit: ordered ? 500 : 50 },
    fields: [dimension, name],
    title: `${measureTitle(draft.op, measure)} by ${dimension}`,
  };
}
