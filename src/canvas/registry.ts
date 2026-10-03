import { chartKinds, type Chart } from '../../shared/dashboard.js';
import type { QueryResult } from '../../shared/data.js';
import { formatCell, isIsoDate } from './format.js';

type Cell = string | number | boolean | null;
export type ChartKind = Chart['kind'];

export interface SeriesPoint { x: Cell; y: number | null }
export type RenderData =
  | { kind: 'metric'; value: number | null; label: string }
  | { kind: 'line' | 'area' | 'bar' | 'pie' | 'treemap'; x: string; y: string; points: SeriesPoint[]; xIsDate: boolean }
  | { kind: 'scatter'; x: string; y: string; points: { x: number; y: number }[] }
  | { kind: 'heatmap'; rows: string[]; cols: string[]; cells: (number | null)[][]; value: string }
  | { kind: 'sankey'; from: string; to: string; links: { source: string; target: string; value: number }[] }
  | { kind: 'table'; columns: string[]; rows: Record<string, Cell>[] };
export type RenderCheck =
  | { ok: true; data: RenderData; empty: boolean }
  | { ok: false; reason: string };

interface Renderer {
  kind: ChartKind;
  label: string;
  check(fields: string[], result: QueryResult): RenderCheck;
}

const fail = (reason: string): RenderCheck => ({ ok: false, reason });

function missing(fields: string[], result: QueryResult): string | undefined {
  const row = result.rows[0];
  return row ? fields.find(field => !Object.hasOwn(row, field)) : undefined;
}
function nonNumeric(field: string, result: QueryResult) {
  return result.rows.some(row => row[field] !== null && typeof row[field] !== 'number');
}

const categoryLimits: Partial<Record<ChartKind, number>> = { pie: 12, treemap: 60 };
const article: Partial<Record<ChartKind, string>> = { area: 'An area', heatmap: 'A heatmap', metric: 'A metric' };
const named = (kind: ChartKind) => article[kind] ?? `A ${kindLabel(kind).toLowerCase()}`;

function series(kind: 'line' | 'area' | 'bar' | 'pie' | 'treemap', fields: string[], result: QueryResult): RenderCheck {
  if (fields.length !== 2) return fail(`${named(kind)} chart needs one category and one number.`);
  const [x, y] = fields as [string, string];
  const absent = missing(fields, result);
  if (absent) return fail(`The query result has no "${absent}" column.`);
  if (nonNumeric(y, result)) return fail(`"${y}" is not numeric, so it cannot be plotted.`);
  const points = result.rows.map(row => ({ x: row[x] ?? null, y: (row[y] ?? null) as number | null }));
  if ((kind === 'line' || kind === 'area') && points.length === 1) return fail(`${named(kind)} chart needs at least 2 points; this query returned 1.`);
  if ((kind === 'pie' || kind === 'treemap') && points.some(p => p.y !== null && p.y < 0)) {
    return fail(`${named(kind)} chart cannot show negative values. Try a bar chart.`);
  }
  const limit = categoryLimits[kind];
  if (limit && points.length > limit) return fail(`${points.length} categories is too many for ${named(kind).toLowerCase()} chart. Try a bar chart.`);
  if (kind === 'pie' && points.length && points.every(p => !p.y)) return fail('Every value is zero, so there is nothing to divide.');
  return { ok: true, empty: points.length === 0,
    data: { kind, x, y, points, xIsDate: points.length > 0 && points.every(p => p.x === null || isIsoDate(p.x)) } };
}

function matrixFields(kind: 'heatmap' | 'sankey', fields: string[], result: QueryResult): RenderCheck | [string, string, string] {
  if (fields.length !== 3) return fail(`${named(kind)} needs two categories and one number.`);
  const absent = missing(fields, result);
  if (absent) return fail(`The query result has no "${absent}" column.`);
  if (nonNumeric(fields[2]!, result)) return fail(`"${fields[2]}" is not numeric.`);
  return fields as [string, string, string];
}

const renderers: Renderer[] = [
  { kind: 'line', label: 'Line', check: (f, r) => series('line', f, r) },
  { kind: 'area', label: 'Area', check: (f, r) => series('area', f, r) },
  { kind: 'bar', label: 'Bar', check: (f, r) => series('bar', f, r) },
  { kind: 'pie', label: 'Donut', check: (f, r) => series('pie', f, r) },
  { kind: 'treemap', label: 'Treemap', check: (f, r) => series('treemap', f, r) },
  { kind: 'metric', label: 'Metric', check(fields, result) {
    const field = fields[fields.length - 1];
    if (!field) return fail('A metric needs one numeric field.');
    if (result.rows.length > 1) return fail(`A metric shows one value; this query returned ${result.rows.length} rows.`);
    const absent = missing([field], result);
    if (absent) return fail(`The query result has no "${absent}" column.`);
    const value = result.rows[0]?.[field] ?? null;
    if (value !== null && typeof value !== 'number') return fail(`"${field}" is not numeric.`);
    return { ok: true, empty: result.rows.length === 0, data: { kind: 'metric', value, label: field } };
  } },
  { kind: 'scatter', label: 'Scatter', check(fields, result) {
    if (fields.length !== 2) return fail('A scatter plot needs two numeric columns.');
    const [x, y] = fields as [string, string];
    const absent = missing(fields, result);
    if (absent) return fail(`The query result has no "${absent}" column.`);
    if (nonNumeric(x, result) || nonNumeric(y, result)) return fail('A scatter plot needs two numeric columns.');
    // Rows with a missing coordinate cannot be placed; they are left out rather than invented.
    const points = result.rows.filter(row => row[x] !== null && row[y] !== null).map(row => ({ x: row[x] as number, y: row[y] as number }));
    return { ok: true, empty: points.length === 0, data: { kind: 'scatter', x, y, points } };
  } },
  { kind: 'heatmap', label: 'Heatmap', check(fields, result) {
    const checked = matrixFields('heatmap', fields, result);
    if (!Array.isArray(checked)) return checked;
    const [r, c, v] = checked;
    const rows = [...new Set(result.rows.map(row => formatCell(row[r] ?? null)))];
    const cols = [...new Set(result.rows.map(row => formatCell(row[c] ?? null)))];
    if (rows.length > 40 || cols.length > 40) return fail('Too many categories for a heatmap (40 per side at most).');
    const cells = rows.map(() => cols.map(() => null as number | null));
    for (const row of result.rows) {
      cells[rows.indexOf(formatCell(row[r] ?? null))]![cols.indexOf(formatCell(row[c] ?? null))] = (row[v] ?? null) as number | null;
    }
    return { ok: true, empty: result.rows.length === 0, data: { kind: 'heatmap', rows, cols, cells, value: v } };
  } },
  { kind: 'sankey', label: 'Sankey', check(fields, result) {
    const checked = matrixFields('sankey', fields, result);
    if (!Array.isArray(checked)) return checked;
    const [s, t, v] = checked;
    const links = result.rows.map(row => ({ source: formatCell(row[s] ?? null), target: formatCell(row[t] ?? null), value: (row[v] ?? 0) as number }));
    if (links.some(l => l.value < 0)) return fail('A sankey cannot show negative flows.');
    const flowing = links.filter(l => l.value > 0);
    if (new Set(flowing.map(l => l.source)).size > 30 || new Set(flowing.map(l => l.target)).size > 30) return fail('Too many categories for a sankey (30 per side at most).');
    return { ok: true, empty: flowing.length === 0, data: { kind: 'sankey', from: s, to: t, links: flowing } };
  } },
  { kind: 'table', label: 'Table', check(fields, result) {
    const absent = missing(fields, result);
    if (absent) return fail(`The query result has no "${absent}" column.`);
    return { ok: true, empty: result.rows.length === 0, data: { kind: 'table', columns: fields, rows: result.rows } };
  } },
];

const byKind = new Map(renderers.map(r => [r.kind, r]));

export const supportedKinds = renderers.map(r => ({ kind: r.kind, label: r.label }));
/** Shared kinds without a renderer. Shown honestly, never faked. Empty once every kind is drawn. */
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
  if (!renderer) return fail(`${kindLabel(chart.kind)} charts are not available yet.`);
  return renderer.check(chart.fields, result);
}
