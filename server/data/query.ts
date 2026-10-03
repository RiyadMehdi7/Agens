import { createHash } from 'node:crypto';
import { validateQueryForDataset, type Dataset, type QueryRequest, type QueryResult } from '../../shared/data.js';
export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export function compare(a: Cell, b: Cell): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
export function evaluate(dataset: Dataset, rows: readonly Row[], input: unknown): QueryResult {
  const q = validateQueryForDataset(input, dataset);
  const selected = rows.filter(row => q.filters.every(f => {
    const actual = row[f.field] ?? null;
    if (f.op === 'in') return f.values.some(v => actual === v.value);
    if (f.op === 'eq') return actual === f.value.value;
    if (f.op === 'ne') return actual !== f.value.value;
    if (actual === null || f.value.value === null) return false;
    const c = compare(actual, f.value.value);
    return f.op === 'gt' ? c > 0 : f.op === 'gte' ? c >= 0 : f.op === 'lt' ? c < 0 : c <= 0;
  }));
  let output: Row[];
  if (q.aggregates) {
    const groups = new Map<string, Row[]>();
    if (!q.groupBy) groups.set('[]', selected);
    else for (const row of selected) {
      const key = JSON.stringify(q.groupBy.map(f => row[f] ?? null));
      const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
    }
    output = [...groups.values()].map(group => {
      const result: Row = Object.fromEntries((q.groupBy ?? []).map(f => [f, group[0]?.[f] ?? null]));
      for (const agg of q.aggregates!) {
        const values = agg.field ? group.map(r => r[agg.field!] ?? null).filter((v): v is Exclude<Cell, null> => v !== null) : [];
        let value: Cell = null;
        if (agg.op === 'count') value = agg.field ? values.length : group.length;
        else if (values.length) {
          if (agg.op === 'sum' || agg.op === 'avg') {
            const sum = values.reduce<number>((s,v) => s + (v as number), 0);
            value = agg.op === 'avg' ? sum / values.length : sum;
          } else value = values.reduce((a,b) => (agg.op === 'min' ? compare(a,b) <= 0 : compare(a,b) >= 0) ? a : b);
        }
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite aggregate');
        result[agg.alias] = value;
      }
      return result;
    });
  } else output = selected.map(row => Object.fromEntries((q.projection ?? dataset.columns.map(c => c.name)).map(f => [f, row[f] ?? null])));
  output.sort((a,b) => {
    for (const sort of q.sort) {
      const x = a[sort.field] ?? null, y = b[sort.field] ?? null;
      const c = compare(x,y);
      if (c) return x === null || y === null ? c : sort.direction === 'desc' ? -c : c;
    }
    return 0;
  });
  const normalized: QueryRequest = { ...q, requestId: undefined };
  const queryId = createHash('sha256').update(JSON.stringify([dataset.id, dataset.capturedAt, normalized, output])).digest('hex');
  return { queryId, datasetId: dataset.id, rows: output.slice(0,q.limit), capturedAt: dataset.capturedAt,
    filters: Object.fromEntries(q.filters.flatMap(f => f.op === 'eq' && f.value.value !== null ? [[f.field, f.value.value]] : [])),
    aggregation: q.aggregates?.map(a => `${a.op}(${a.field ?? '*'}) as ${a.alias}`).join(', ') ?? 'projection',
    truncated: output.length > q.limit, normalizedRequest: q };
}
