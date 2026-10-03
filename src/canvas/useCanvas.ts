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
export interface Status { text: string; tone: 'info' | 'error'; action?: { label: string; run: () => void } }
export type ServerData = 'checking' | 'available' | 'unavailable' | 'unreachable';
/** A workbook waiting for the user to pick one of several sheets. */
export interface SheetChoice { name: string; contentBase64: string; sheets: string[] }
export type SourceState = 'refreshing' | 'failed';
export type AddOutcome = { ok: true; chart: Chart; result: QueryResult } | { ok: false; reason: string };
export type PlanOutcome = { ok: true; added: Chart[]; results: QueryResult[]; skipped: string[]; summary: string } | { ok: false; reason: string };

/** Dashboard actions without expectedRevision; dispatch supplies the current one. */
export type DashboardAction = { type: 'add'; chart: Chart } | { type: 'update'; chartId: string; patch: Partial<Pick<Chart, 'title' | 'kind' | 'fields'>> }
  | { type: 'remove'; chartId: string } | { type: 'reorder'; chartIds: string[] } | { type: 'select'; chartId: string | null };

const emptyDashboard: Dashboard = { revision: 0, charts: [], selectedChartId: null };
export const http = new HttpApi();
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
  const [voiceReady, setVoiceReady] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [results, setResults] = useState<Record<string, QueryResult>>({});
  const [layout, setLayout] = useState<Record<string, TileLayout>>({});
  const [pending, setPending] = useState<PendingTile[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [sheetChoice, setSheetChoice] = useState<SheetChoice | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sourceState, setSourceState] = useState<Record<string, SourceState>>({});
  const dashboardRef = useRef(dashboard);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const apiRef = useRef<AgensApi>(api);
  apiRef.current = api;
  const generation = useRef(0);

  const fail = useCallback((error: unknown) => setStatus({ text: toFailure(error).message, tone: 'error' }), []);

  useEffect(() => {
    let live = true;
    fetch('/api/health', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(async (body: { availability?: { data?: string; voice?: string } }) => {
        if (live) setVoiceReady(body.availability?.voice === 'configured');
        const available = ['adapter-injected', 'ready'].includes(body.availability?.data ?? '');
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

  const leaveSample = useCallback(() => {
    if (apiRef.current.mode === 'sample') { resetCanvas(); setApi(http); setDatasets([]); setActiveId(null); }
  }, [resetCanvas]);

  const register = useCallback((dataset: Dataset, verb: string) => {
    setDatasets(list => [...list.filter(d => d.id !== dataset.id), dataset]);
    setActiveId(dataset.id);
    setStatus({ text: `${dataset.name} ${verb} · ${dataset.rowCount.toLocaleString('en-US')} rows`, tone: 'info' });
  }, []);

  const runImport = useCallback(async (name: string, format: 'csv' | 'xlsx', contentBase64: string, sheet?: string) => {
    setImporting(name);
    setStatus({ text: `Reading ${name}…`, tone: 'info' });
    try {
      // A multi-sheet workbook asks which sheet to use; the server lists them without registering anything.
      if (format === 'xlsx' && !sheet) {
        const sheets = await http.inspect({ format, name, contentBase64 });
        if (sheets.length > 1) {
          setSheetChoice({ name, contentBase64, sheets });
          setStatus({ text: `Choose a sheet from ${name}`, tone: 'info' });
          return;
        }
      }
      const dataset = await http.importDataset({ format, name, contentBase64, ...(sheet ? { sheet } : {}) });
      setSheetChoice(null);
      register(dataset, 'connected');
    } catch (error) {
      fail(error);
    } finally {
      setImporting(null);
    }
  }, [fail, register]);

  const importFile = useCallback(async (file: File) => {
    const format = /\.csv$/i.test(file.name) ? 'csv' : /\.xlsx$/i.test(file.name) ? 'xlsx' : null;
    if (!format) { fail(new ApiFailure('INVALID_REQUEST', 'Choose an .xlsx or .csv file.')); return; }
    if (file.size > 256 * 1024) { fail(new ApiFailure('PAYLOAD_TOO_LARGE')); return; }
    leaveSample();
    setSheetChoice(null);
    await runImport(file.name.slice(0, 200), format, await toBase64(file));
  }, [fail, leaveSample, runImport]);

  const chooseSheet = useCallback(async (sheet: string | null) => {
    const choice = sheetChoice;
    if (!choice) return;
    if (sheet === null) { setSheetChoice(null); setStatus(null); return; }
    await runImport(choice.name, 'xlsx', choice.contentBase64, sheet);
  }, [runImport, sheetChoice]);

  /** Attach an operator-configured Postgres or HTTPS source. The token is sent once and never stored. */
  const connectSource = useCallback(async (sourceId: string, accessToken: string): Promise<boolean> => {
    leaveSample();
    setConnecting(true);
    setStatus({ text: 'Connecting…', tone: 'info' });
    try {
      register(await http.connect({ sourceId: sourceId.trim(), accessToken: accessToken.trim() }), 'connected');
      return true;
    } catch (error) {
      if (error instanceof ApiFailure && ['NOT_FOUND', 'FORBIDDEN', 'INVALID_REQUEST', 'CONFLICT'].includes(error.code)) {
        setStatus({ text: 'That source ID or access token was not accepted.', tone: 'error' });
      } else fail(error);
      return false;
    } finally {
      setConnecting(false);
    }
  }, [fail, leaveSample, register]);

  const loadSample = useCallback(async () => {
    resetCanvas();
    const dataset = await sample.loadSample();
    setApi(sample); setDatasets([dataset]); setActiveId(dataset.id);
    setStatus({ text: 'Using synthetic sample data. Nothing here is real.', tone: 'info' });
  }, [resetCanvas]);

  /** Add one chart. Resolves with the chart and its evidence, or a readable reason (voice tools speak it). */
  const addChart = useCallback(async (draft: ChartDraft, titleOverride?: string): Promise<AddOutcome> => {
    const dataset = datasets.find(d => d.id === activeId);
    const reject = (reason: string): AddOutcome => { setStatus({ text: reason, tone: 'error' }); return { ok: false, reason }; };
    if (!dataset) return reject('Connect a source first.');
    let planned;
    try { planned = planChart(draft, dataset); }
    catch (error) { return reject((error as Error).message); }
    const key = newChartId();
    const title = (titleOverride?.trim() || planned.title).slice(0, 200);
    const tile: PendingTile = { key, title, kind: draft.kind, size: defaultSize[draft.kind],
      color: dashboardRef.current.charts.length % palette.length };
    const gen = generation.current;
    setPending(list => [...list, tile]);
    setStatus(null);
    try {
      const result = await api.query(planned.request);
      if (gen !== generation.current) return { ok: false, reason: 'The canvas was cleared while the query ran.' };
      const chart: Chart = { id: key, datasetId: dataset.id, title, kind: draft.kind, fields: planned.fields, queryId: result.queryId };
      setResults(r => ({ ...r, [result.queryId]: result }));
      setLayout(l => ({ ...l, [key]: { size: tile.size, color: tile.color } }));
      if (!dispatch({ type: 'add', chart })) return { ok: false, reason: 'The dashboard changed; try again.' };
      return { ok: true, chart, result };
    } catch (error) {
      if (gen === generation.current) fail(error);
      return { ok: false, reason: toFailure(error).message };
    } finally {
      setPending(list => list.filter(p => p.key !== key));
    }
  }, [activeId, api, datasets, dispatch, fail]);

  const plans = useRef(new Map<string, { cancelled: boolean; keys: string[] }>());
  /**
   * Slow, asynchronous planning (voice "build me a dashboard"). Placeholder tiles fog in at once;
   * results are applied only if this request was not cancelled and the canvas was not reset meanwhile.
   */
  const planDashboard = useCallback(async (prompt: string, requestId: string): Promise<PlanOutcome> => {
    if (apiRef.current.mode !== 'server') return { ok: false, reason: 'Planning needs the data service; sample mode cannot plan.' };
    if (!datasets.length) return { ok: false, reason: 'No data is connected yet.' };
    const gen = generation.current;
    const keys = [newChartId(), newChartId()];
    const base = dashboardRef.current.charts.length;
    plans.current.set(requestId, { cancelled: false, keys });
    setPending(list => [...list, ...keys.map((key, i) => ({ key, title: 'Planning…', kind: (i ? 'bar' : 'line') as Chart['kind'],
      size: i ? 1 : 2, color: (base + i) % palette.length }))]);
    try {
      const { charts: current, selectedChartId } = dashboardRef.current;
      const evidence = current.map(c => ({ datasetId: c.datasetId, queryId: c.queryId }));
      const plan = await http.plan({ requestId, prompt: prompt.slice(0, 4000), dashboard: { ...dashboardRef.current, charts: current, selectedChartId }, evidence });
      const entry = plans.current.get(requestId);
      if (!entry || entry.cancelled || gen !== generation.current) return { ok: false, reason: 'That request was cancelled.' };
      const added: Chart[] = [];
      plan.charts.forEach(({ chart, result }, i) => {
        const id = newChartId();
        const full: Chart = { ...chart, id };
        setResults(r => ({ ...r, [result.queryId]: result }));
        setLayout(l => ({ ...l, [id]: { size: defaultSize[chart.kind], color: (base + i) % palette.length } }));
        if (dispatch({ type: 'add', chart: full })) added.push(full);
      });
      return { ok: true, added, results: plan.charts.map(c => c.result), skipped: plan.skipped, summary: plan.summary };
    } catch (error) {
      if (gen === generation.current) fail(error);
      return { ok: false, reason: toFailure(error).message };
    } finally {
      plans.current.delete(requestId);
      setPending(list => list.filter(p => !keys.includes(p.key)));
    }
  }, [datasets.length, dispatch, fail]);

  /** Cancel in-flight planning: its placeholders vanish and its late result is discarded. */
  const cancelPlans = useCallback((requestIds: string[]) => {
    for (const id of requestIds) {
      const entry = plans.current.get(id);
      if (!entry) continue;
      entry.cancelled = true;
      setPending(list => list.filter(p => !entry.keys.includes(p.key)));
    }
  }, []);

  /** Point a chart at newer evidence, keeping its place and the current selection. */
  const replaceEvidence = useCallback((chartId: string, queryId: string) => {
    const { charts, selectedChartId } = dashboardRef.current;
    const index = charts.findIndex(c => c.id === chartId);
    const chart = charts[index];
    if (!chart || chart.queryId === queryId) return;
    const order = charts.map(c => c.id);
    if (!dispatch({ type: 'remove', chartId }) || !dispatch({ type: 'add', chart: { ...chart, queryId } })) return;
    dispatch({ type: 'reorder', chartIds: order });
    if (dashboardRef.current.selectedChartId !== selectedChartId) dispatch({ type: 'select', chartId: selectedChartId });
  }, [dispatch]);

  /**
   * Refresh a live source, then re-run each of its charts with the exact request recorded in its evidence.
   * A chart whose request no longer fits the refreshed schema keeps its earlier evidence.
   */
  const refreshDataset = useCallback(async (datasetId: string) => {
    setSourceState(s => ({ ...s, [datasetId]: 'refreshing' }));
    try {
      const dataset = await http.refresh(datasetId);
      setDatasets(list => list.map(d => (d.id === datasetId ? dataset : d)));
      let kept = 0;
      for (const chart of dashboardRef.current.charts.filter(c => c.datasetId === datasetId)) {
        const request = resultsRef.current[chart.queryId]?.normalizedRequest;
        if (!request) { kept += 1; continue; }
        try {
          const result = await http.query({ ...request, datasetId });
          setResults(r => ({ ...r, [result.queryId]: result }));
          replaceEvidence(chart.id, result.queryId);
        } catch { kept += 1; }
      }
      setSourceState(({ [datasetId]: _, ...rest }) => rest);
      setStatus({ text: kept ? `${dataset.name} refreshed · ${kept} chart${kept > 1 ? 's' : ''} kept earlier data` : `${dataset.name} refreshed`, tone: kept ? 'error' : 'info' });
    } catch (error) {
      setSourceState(s => ({ ...s, [datasetId]: 'failed' }));
      if (error instanceof ApiFailure && error.code === 'INVALID_REQUEST') setStatus({ text: 'Uploads are snapshots. Upload the file again to update it.', tone: 'info' });
      else fail(error);
    }
  }, [fail, replaceEvidence]);

  const controls = useMemo(() => ({
    select: (chartId: string | null) => dispatch({ type: 'select', chartId }),
    /** Close a chart, offering Undo. Its evidence stays cached, so undo re-adds the same query. */
    remove: (chartId: string) => {
      const charts = dashboardRef.current.charts;
      const index = charts.findIndex(c => c.id === chartId);
      const chart = charts[index];
      if (!chart) return;
      const saved = layoutRef.current[chartId];
      if (!dispatch({ type: 'remove', chartId })) return;
      setStatus({ text: `Closed “${chart.title}”`, tone: 'info', action: { label: 'Undo', run: () => {
        if (dashboardRef.current.charts.some(c => c.id === chart.id)) return;
        if (!dispatch({ type: 'add', chart })) return;
        const ids = dashboardRef.current.charts.map(c => c.id).filter(id => id !== chart.id);
        ids.splice(Math.min(index, ids.length), 0, chart.id);
        dispatch({ type: 'reorder', chartIds: ids });
        if (saved) setLayout(l => ({ ...l, [chart.id]: saved }));
        setStatus(null);
      } } });
    },
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
    api, serverData, voiceReady, datasets, activeDataset: datasets.find(d => d.id === activeId) ?? null, setActiveId,
    dashboard, results, layout, pending, importing, status, setStatus,
    importFile, loadSample, addChart, dispatch, ...controls,
    sheetChoice, chooseSheet, connecting, connectSource, sourceState, refreshDataset, planDashboard, cancelPlans,
  };
}

export type CanvasState = ReturnType<typeof useCanvas>;
