import { chartKinds, type Chart } from '../../shared/dashboard.js';
import type { QueryResult } from '../../shared/data.js';
import { isIsoDate } from './format.js';

type Cell = string | number | boolean | null;
export type ChartKind = Chart['kind'];

export interface SeriesPoint { x: Cell; y: number | null }
export type RenderData =
  | { kind: 'metric'; value: number | null; label: string }
  | { kind: 'line' | 'bar'; x: string; y: string; points: SeriesPoint[]; xIsDate: boolean }
  | { kind: 'table'; columns: string[]; rows: Record<string, Cell>[] };
export type RenderCheck =
  | { ok: true; data: RenderData; empty: boolean }
  | { ok: false; reason: string };

interface Renderer {
  kind: ChartKind;
  label: string;
  /** What the renderer needs from `chart.fields`, shown when a chart cannot be drawn. */
  needs: string;
  check(fields: string[], result: QueryResult): RenderCheck;
}

function missing(fields: string[], result: QueryResult): string | undefined {
  const row = result.rows[0];
  if (!row) return undefined;
  return fields.find(field => !Object.hasOwn(row, field));
}

function series(kind: 'line' | 'bar', fields: string[], result: QueryResult, minPoints: number): RenderCheck {
  if (fields.length !== 2) return { ok: false, reason: `${kind === 'line' ? 'A line' : 'A bar'} chart needs one category and one number.` };
  const [x, y] = fields as [string, string];
  const absent = missing(fields, result);
  if (absent) return { ok: false, reason: `The query result has no "${absent}" column.` };
  if (result.rows.some(row => row[y] !== null && typeof row[y] !== 'number')) {
    return { ok: false, reason: `"${y}" is not numeric, so it cannot be plotted.` };
  }
  const points = result.rows.map(row => ({ x: row[x] ?? null, y: (row[y] ?? null) as number | null }));
  if (result.rows.length > 0 && result.rows.length < minPoints) {
    return { ok: false, reason: `A line needs at least ${minPoints} points; this query returned ${result.rows.length}.` };
  }
  return { ok: true, empty: points.length === 0,
    data: { kind, x, y, points, xIsDate: points.length > 0 && points.every(p => p.x === null || isIsoDate(p.x)) } };
}

const renderers: Renderer[] = [
  { kind: 'metric', label: 'Metric', needs: 'one numeric value', check(fields, result) {
    const field = fields[fields.length - 1];
    if (!field) return { ok: false, reason: 'A metric needs one numeric field.' };
    if (result.rows.length > 1) return { ok: false, reason: `A metric shows one value; this query returned ${result.rows.length} rows.` };
    const absent = missing([field], result);
    if (absent) return { ok: false, reason: `The query result has no "${absent}" column.` };
    const value = result.rows[0]?.[field] ?? null;
    if (value !== null && typeof value !== 'number') return { ok: false, reason: `"${field}" is not numeric.` };
    return { ok: true, empty: result.rows.length === 0, data: { kind: 'metric', value, label: field } };
  } },
  { kind: 'line', label: 'Line', needs: 'a category and a number', check: (f, r) => series('line', f, r, 2) },
  { kind: 'bar', label: 'Bar', needs: 'a category and a number', check: (f, r) => series('bar', f, r, 1) },
  { kind: 'table', label: 'Table', needs: 'any columns', check(fields, result) {
    const absent = missing(fields, result);
    if (absent) return { ok: false, reason: `The query result has no "${absent}" column.` };
    return { ok: true, empty: result.rows.length === 0, data: { kind: 'table', columns: fields, rows: result.rows } };
  } },
];

const byKind = new Map(renderers.map(r => [r.kind, r]));

export const supportedKinds = renderers.map(r => ({ kind: r.kind, label: r.label }));
/** Kinds in the shared schema without a renderer yet. Shown honestly, never faked. */
export const unsupportedKinds = chartKinds.filter(kind => !byKind.has(kind));

export function isSupported(kind: ChartKind): boolean {
  return byKind.has(kind);
}

export function kindLabel(kind: ChartKind): string {
  return byKind.get(kind)?.label ?? kind[0]!.toUpperCase() + kind.slice(1);
}

/** Validate a chart against its actual query evidence before drawing anything. */
export function checkChart(chart: Pick<Chart, 'kind' | 'fields'>, result: QueryResult): RenderCheck {
  const renderer = byKind.get(chart.kind);
  if (!renderer) return { ok: false, reason: `${kindLabel(chart.kind)} charts are not available yet.` };
  return renderer.check(chart.fields, result);
}
