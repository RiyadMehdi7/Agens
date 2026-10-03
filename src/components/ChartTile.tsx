import { useState } from 'react';
import type { Chart } from '../../shared/dashboard.js';
import type { QueryResult } from '../../shared/data.js';
import { formatTime } from '../canvas/format.js';
import { checkChart, kindLabel, supportedKinds } from '../canvas/registry.js';
import { palette, sizes, type CanvasState, type PendingTile, type TileLayout } from '../canvas/useCanvas.js';
import { ChartView, Ghost } from './Charts.js';
import { ArrowIcon, CloseIcon } from './icons.js';

interface Props {
  chart: Chart;
  result: QueryResult | undefined;
  layout: TileLayout;
  selected: boolean;
  index: number;
  count: number;
  freshness: string | undefined;
  canvas: CanvasState;
}

export function ChartTile({ chart, result, layout, selected, index, count, freshness, canvas }: Props) {
  const size = sizes[layout.size] ?? sizes[1];
  const color = palette[layout.color] ?? palette[0];
  const check = result ? checkChart(chart, result) : { ok: false as const, reason: 'This chart’s query evidence is missing.' };
  const [closing, setClosing] = useState(false);
  // Let the blur-out play before the reducer removes the chart.
  const close = () => { if (closing) return; setClosing(true); setTimeout(() => canvas.remove(chart.id), 260); };
  const provenance = result
    ? `${result.aggregation === 'none' ? 'Rows' : result.aggregation} · ${freshness ?? 'snapshot'} ${formatTime(result.capturedAt)}${result.truncated ? ' · partial' : ''}${selected ? ' · selected' : ''}`
    : 'Query evidence missing';
  const kinds = supportedKinds.some(k => k.kind === chart.kind) ? supportedKinds : [...supportedKinds, { kind: chart.kind, label: kindLabel(chart.kind) }];
  return (
    <section className={`tile${selected ? ' selected' : ''}${closing ? ' closing' : ''}`} style={{ gridColumn: `span ${size.span}`, height: size.height }}
      aria-label={chart.title}
      onKeyDown={e => {
        const tag = (e.target as HTMLElement).tagName;
        if ((e.key === 'Delete' || e.key === 'Backspace') && tag !== 'SELECT' && tag !== 'INPUT') { e.preventDefault(); close(); }
      }}>
      <header>
        <button className="tile-title" onClick={() => canvas.select(selected ? null : chart.id)} aria-pressed={selected}
          title={provenance}>{chart.title}</button>
        {/* Only exceptional provenance is shown inline; the full record is in the title tooltip. */}
        {freshness === 'sample' && <span className="mark sample" title="Synthetic sample data, not real">sample</span>}
        {result?.truncated && <span className="mark partial" title={`Limited to the first ${result.rows.length} rows`}>partial</span>}
        <div className="tools">
          <label className="sr-only" htmlFor={`kind-${chart.id}`}>Chart type</label>
          <select id={`kind-${chart.id}`} className="kind-select" value={chart.kind}
            onChange={e => canvas.changeKind(chart.id, e.target.value as Chart['kind'])}>
            {kinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <button className="ib" onClick={() => canvas.recolor(chart.id)} aria-label="Change color"><span className="swatch" style={{ background: color }} /></button>
          <button className="ib" onClick={() => canvas.resize(chart.id)} aria-label={`Resize, currently ${size.label}`}>{size.label}</button>
          <button className="ib" onClick={() => canvas.move(chart.id, -1)} disabled={index === 0} aria-label="Move earlier"><ArrowIcon dir="left" /></button>
          <button className="ib" onClick={() => canvas.move(chart.id, 1)} disabled={index === count - 1} aria-label="Move later"><ArrowIcon dir="right" /></button>
        </div>
        <button className="tile-close" onClick={close} aria-label={`Close ${chart.title}`} title="Close (Delete)"><CloseIcon size={14} /></button>
      </header>
      {/* Keyed by kind so a type change replays the reveal. */}
      <div className="body reveal" key={chart.kind}>
        {!check.ok ? <p className="notice">{check.reason}</p>
          : check.empty ? <p className="notice">No rows match this query.</p>
          : <ChartView data={check.data} color={color} title={chart.title} />}
      </div>
    </section>
  );
}

export function PendingChartTile({ tile }: { tile: PendingTile }) {
  const size = sizes[tile.size] ?? sizes[1];
  const color = palette[tile.color] ?? palette[0];
  return (
    <section className="tile" style={{ gridColumn: `span ${size.span}`, height: size.height }} aria-busy="true" aria-label={`${tile.title}, loading`}>
      <div className="orb" style={{ background: color }} />
      <header><span className="tile-title" style={{ color: 'var(--muted)' }}>{tile.title}</span></header>
      <div className="body fog"><Ghost /></div>
    </section>
  );
}
