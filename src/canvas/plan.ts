import type { Chart } from '../../shared/dashboard.js';
import type { Dataset } from '../../shared/data.js';
import type { QueryInput } from '../api/types.js';

export type Aggregate = 'sum' | 'avg' | 'count' | 'min' | 'max';
export interface ChartDraft {
  kind: 'metric' | 'line' | 'bar' | 'table';
  dimension?: string;
  measure?: string;
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
 * the draft does not fit the dataset. Voice planning will produce the same shape (issue #4).
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
  const { name, spec } = aggregate([dimension]);
  const sort = draft.kind === 'line'
    ? [{ field: dimension, direction: 'asc' as const }]
    : [{ field: name, direction: 'desc' as const }];
  return {
    request: { ...base, groupBy: [dimension], aggregates: [spec], sort, limit: draft.kind === 'line' ? 500 : 50 },
    fields: [dimension, name],
    title: `${measureTitle(draft.op, measure)} by ${dimension}`,
  };
}

let counter = 0;
export function newChartId(): Chart['id'] {
  counter += 1;
  return `chart_${Date.now().toString(36)}_${counter}`;
}
