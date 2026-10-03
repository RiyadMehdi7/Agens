import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyDashboardAction, type Chart, type Dashboard } from '../../shared/dashboard.js';
import type { Dataset, QueryResult } from '../../shared/data.js';
import { ApiFailure, toFailure } from '../api/errors.js';
import { HttpApi, onSessionReset } from '../api/http.js';
import { SampleApi } from '../api/sample.js';
import type { AgensApi } from '../api/types.js';
import { newChartId, planChart, type ChartDraft } from './plan.js';

export const palette = ['#FF8A4C', '#5B8CFF', '#3DD6A3', '#E7C26A', '#C77DFF'] as const;
export const sizes = [
  { label: 'S', span: 4, height: 260 }, { label: 'M', span: 6, height: 300 },
  { label: 'L', span: 8, height: 320 }, { label: 'XL', span: 12, height: 360 },
] as const;
const defaultSize: Record<Chart['kind'], number> = { metric: 0, line: 2, bar: 1, table: 1, area: 2, scatter: 1,
  pie: 1, heatmap: 3, treemap: 2, sankey: 3 };

/** Presentation only. Never part of the shared dashboard, so it cannot affect evidence. */
export interface TileLayout { size: number; color: number }
export interface PendingTile { key: string; title: string; kind: Chart['kind']; size: number; color: number }
export interface Status { text: string; tone: 'info' | 'error' }
export type ServerData = 'checking' | 'available' | 'unavailable' | 'unreachable';

/** Dashboard actions without expectedRevision; dispatch supplies the current one. */
export type DashboardAction = { type: 'add'; chart: Chart } | { type: 'update'; chartId: string; patch: Partial<Pick<Chart, 'title' | 'kind' | 'fields'>> }
  | { type: 'remove'; chartId: string } | { type: 'reorder'; chartIds: string[] } | { type: 'select'; chartId: string | null };

const emptyDashboard: Dashboard = { revision: 0, charts: [], selectedChartId: null };
const http = new HttpApi();
const sample = new SampleApi();

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function useCanvas() {
  const [api, setApi] = useState<AgensApi>(http);
  const [serverData, setServerData] = useState<ServerData>('checking');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [results, setResults] = useState<Record<string, QueryResult>>({});
  const [layout, setLayout] = useState<Record<string, TileLayout>>({});
  const [pending, setPending] = useState<PendingTile[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const dashboardRef = useRef(dashboard);
  const apiRef = useRef<AgensApi>(api);
  apiRef.current = api;
  const generation = useRef(0);

  const fail = useCallback((error: unknown) => setStatus({ text: toFailure(error).message, tone: 'error' }), []);

  useEffect(() => {
    let live = true;
    fetch('/api/health', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(async (body: { availability?: { data?: string } }) => {
        const available = body.availability?.data === 'adapter-injected';
        if (live) setServerData(available ? 'available' : 'unavailable');
        if (!available) return;
        // Datasets live in the server session, so a reload can reconnect them (charts are client-side).
        const restored = await http.listDatasets().catch(() => []);
        if (live && restored.length) { setDatasets(restored); setActiveId(restored[restored.length - 1]!.id); }
      })
      .catch(() => { if (live) setServerData('unreachable'); });
    return () => { live = false; };
  }, []);

  /**
   * The single entry point for dashboard changes. Manual controls and voice (issue #4) both use it,
   * so every change passes the shared reducer's validation and revision check.
   */
  const dispatch = useCallback((action: DashboardAction): boolean => {
    try {
      const next = applyDashboardAction(dashboardRef.current, { ...action, expectedRevision: dashboardRef.current.revision });
      dashboardRef.current = next;
      setDashboard(next);
      return true;
    } catch {
      setStatus({ text: 'That change no longer fits the dashboard. Try again.', tone: 'error' });
      return false;
    }
  }, []);

  const resetCanvas = useCallback(() => {
    generation.current += 1;
    dashboardRef.current = emptyDashboard;
    setDashboard(emptyDashboard); setResults({}); setLayout({}); setPending([]);
  }, []);

  useEffect(() => onSessionReset(() => {
    if (apiRef.current.mode !== 'server') return;
    resetCanvas(); setDatasets([]); setActiveId(null);
    setStatus({ text: 'Your previous session expired, so earlier data was cleared.', tone: 'info' });
  }), [resetCanvas]);

  const importFile = useCallback(async (file: File, sheet?: string) => {
    const format = /\.csv$/i.test(file.name) ? 'csv' : /\.xlsx$/i.test(file.name) ? 'xlsx' : null;
    if (!format) { fail(new ApiFailure('INVALID_REQUEST', 'Choose an .xlsx or .csv file.')); return; }
    if (file.size > 256 * 1024) { fail(new ApiFailure('PAYLOAD_TOO_LARGE')); return; }
    if (api.mode === 'sample') { resetCanvas(); setApi(http); setDatasets([]); setActiveId(null); }
    setImporting(file.name);
    setStatus({ text: `Reading ${file.name}…`, tone: 'info' });
    try {
      const dataset = await http.importDataset({ format, name: file.name.slice(0, 200), contentBase64: await toBase64(file),
        ...(format === 'xlsx' && sheet?.trim() ? { sheet: sheet.trim().slice(0, 100) } : {}) });
      setDatasets(list => [...list.filter(d => d.id !== dataset.id), dataset]);
      setActiveId(dataset.id);
      setStatus({ text: `${dataset.name} connected · ${dataset.rowCount.toLocaleString('en-US')} rows`, tone: 'info' });
    } catch (error) {
      fail(error);
    } finally {
      setImporting(null);
    }
  }, [api.mode, fail, resetCanvas]);

  const loadSample = useCallback(async () => {
    resetCanvas();
    const dataset = await sample.loadSample();
    setApi(sample); setDatasets([dataset]); setActiveId(dataset.id);
    setStatus({ text: 'Using synthetic sample data. Nothing here is real.', tone: 'info' });
  }, [resetCanvas]);

  const addChart = useCallback(async (draft: ChartDraft) => {
    const dataset = datasets.find(d => d.id === activeId);
    if (!dataset) { setStatus({ text: 'Connect a source first.', tone: 'error' }); return; }
    let planned;
    try { planned = planChart(draft, dataset); }
    catch (error) { setStatus({ text: (error as Error).message, tone: 'error' }); return; }
    const key = newChartId();
    const tile: PendingTile = { key, title: planned.title, kind: draft.kind, size: defaultSize[draft.kind],
      color: dashboardRef.current.charts.length % palette.length };
    const gen = generation.current;
    setPending(list => [...list, tile]);
    setStatus(null);
    try {
      const result = await api.query(planned.request);
      if (gen !== generation.current) return; // The canvas was reset while this query ran.
      const chart: Chart = { id: key, datasetId: dataset.id, title: planned.title.slice(0, 200), kind: draft.kind,
        fields: planned.fields, queryId: result.queryId };
      setResults(r => ({ ...r, [result.queryId]: result }));
      setLayout(l => ({ ...l, [key]: { size: tile.size, color: tile.color } }));
      dispatch({ type: 'add', chart });
    } catch (error) {
      if (gen === generation.current) fail(error);
    } finally {
      setPending(list => list.filter(p => p.key !== key));
    }
  }, [activeId, api, datasets, dispatch, fail]);

  const controls = useMemo(() => ({
    select: (chartId: string | null) => dispatch({ type: 'select', chartId }),
    remove: (chartId: string) => dispatch({ type: 'remove', chartId }),
    /** Type changes keep the same query and fields; the renderer says if they do not fit. */
    changeKind: (chartId: string, kind: Chart['kind']) => dispatch({ type: 'update', chartId, patch: { kind } }),
    rename: (chartId: string, title: string) => title.trim() && dispatch({ type: 'update', chartId, patch: { title: title.trim().slice(0, 200) } }),
    move: (chartId: string, delta: -1 | 1) => {
      const ids = dashboardRef.current.charts.map(c => c.id);
      const from = ids.indexOf(chartId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]!);
      dispatch({ type: 'reorder', chartIds: ids });
    },
    recolor: (chartId: string) => setLayout(l => {
      const current = l[chartId] ?? { size: 1, color: 0 };
      return { ...l, [chartId]: { ...current, color: (current.color + 1) % palette.length } };
    }),
    resize: (chartId: string) => setLayout(l => {
      const current = l[chartId] ?? { size: 1, color: 0 };
      return { ...l, [chartId]: { ...current, size: (current.size + 1) % sizes.length } };
    }),
  }), [dispatch]);

  return {
    api, serverData, datasets, activeDataset: datasets.find(d => d.id === activeId) ?? null, setActiveId,
    dashboard, results, layout, pending, importing, status, setStatus,
    importFile, loadSample, addChart, dispatch, ...controls,
  };
}

export type CanvasState = ReturnType<typeof useCanvas>;
