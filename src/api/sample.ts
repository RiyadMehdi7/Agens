import type { ImportRequest } from '../../shared/api.js';
import { validateQueryForDataset, type Dataset, type QueryRequest, type QueryResult } from '../../shared/data.js';
import { ApiFailure } from './errors.js';
import type { AgensApi, QueryInput } from './types.js';

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

const months = [412, 431, 447, 468, 489, 512, 538, 494, 521];
const regions: [string, number][] = [['North America', 0.39], ['Europe', 0.32], ['APAC', 0.195], ['LATAM', 0.095]];

/** Synthetic revenue rows. Nothing here is real customer data. */
export function sampleRows(): Row[] {
  const rows: Row[] = [];
  months.forEach((thousands, m) => {
    for (const [region, share] of regions) {
      rows.push({
        month: new Date(Date.UTC(2026, m, 1)).toISOString(),
        region,
        revenue: Math.round(thousands * share * 1000),
        accounts: Math.round(thousands * share * 1.7),
      });
    }
  });
  return rows;
}

export const sampleDataset: Dataset = {
  id: 'sample_revenue', sourceId: 'sample_source', kind: 'excel', name: 'Sample revenue (synthetic)',
  columns: [{ name: 'month', type: 'date' }, { name: 'region', type: 'string' },
    { name: 'revenue', type: 'number' }, { name: 'accounts', type: 'number' }],
  rowCount: months.length * regions.length, capturedAt: '2026-10-03T09:42:00.000Z', freshness: 'sample',
};

function compare(a: Cell, b: Cell): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

/** Deterministic evaluator for the fixture only. The real engine lives in server/data (issue #2). */
export function evaluateSample(dataset: Dataset, rows: Row[], request: QueryRequest): Omit<QueryResult, 'queryId'> {
  if (request.filters.length) throw new ApiFailure('NOT_IMPLEMENTED', 'Sample data does not support filters.');
  let output: Row[];
  let aggregation: string;
  if (request.aggregates) {
    const keys = request.groupBy ?? [];
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = JSON.stringify(keys.map(k => row[k] ?? null));
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    if (!keys.length && !groups.size) groups.set('[]', []);
    output = [...groups.values()].map(group => {
      const out: Row = {};
      for (const k of keys) out[k] = group[0]?.[k] ?? null;
      for (const agg of request.aggregates!) {
        const values = agg.field ? group.map(r => r[agg.field!] ?? null).filter((v): v is number | string => v !== null) : group;
        if (agg.op === 'count') { out[agg.alias] = values.length; continue; }
        const nums = values as number[];
        if (!nums.length) { out[agg.alias] = null; continue; }
        const sum = nums.reduce((a, b) => a + b, 0);
        out[agg.alias] = agg.op === 'sum' ? sum : agg.op === 'avg' ? sum / nums.length
          : agg.op === 'min' ? Math.min(...nums) : Math.max(...nums);
      }
      return out;
    });
    aggregation = request.aggregates.map(a => `${a.op}(${a.field ?? '*'})`).join(', ') + (keys.length ? ` by ${keys.join(', ')}` : '');
  } else {
    const fields = request.projection ?? dataset.columns.map(c => c.name);
    output = rows.map(row => Object.fromEntries(fields.map(f => [f, row[f] ?? null])));
    aggregation = 'none';
  }
  for (const s of [...request.sort].reverse()) {
    output = output.map((row, i) => ({ row, i })).sort((a, b) => {
      const av = a.row[s.field] ?? null, bv = b.row[s.field] ?? null;
      if (av === null || bv === null) return compare(av, bv) || a.i - b.i;
      return (s.direction === 'asc' ? compare(av, bv) : compare(bv, av)) || a.i - b.i;
    }).map(x => x.row);
  }
  const truncated = output.length > request.limit;
  return { datasetId: dataset.id, rows: output.slice(0, request.limit), capturedAt: dataset.capturedAt,
    filters: {}, aggregation, truncated, normalizedRequest: request };
}

/** In-browser fixture used while the data engine is not wired into the API. Always labelled sample. */
export class SampleApi implements AgensApi {
  readonly mode = 'sample' as const;
  private loaded = false;
  private count = 0;
  async listDatasets(): Promise<Dataset[]> { return this.loaded ? [structuredClone(sampleDataset)] : []; }
  async importDataset(_request: ImportRequest): Promise<Dataset> {
    throw new ApiFailure('NOT_IMPLEMENTED', 'Uploads need the data service. Sample mode only has synthetic data.');
  }
  async loadSample(): Promise<Dataset> { this.loaded = true; return structuredClone(sampleDataset); }
  async query(input: QueryInput): Promise<QueryResult> {
    if (!this.loaded) throw new ApiFailure('NOT_FOUND');
    let request: QueryRequest;
    try { request = validateQueryForDataset(input, sampleDataset); }
    catch { throw new ApiFailure('INVALID_REQUEST', 'That chart does not match the dataset columns.'); }
    await new Promise(resolve => setTimeout(resolve, 700 + Math.random() * 1400));
    this.count += 1;
    return { queryId: `sample_q${this.count}`, ...evaluateSample(sampleDataset, sampleRows(), request) };
  }
}
