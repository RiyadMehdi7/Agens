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
  const kinds = supportedKinds.some(k => k.kind === chart.kind) ? supportedKinds : [...supportedKinds, { kind: chart.kind, label: kindLabel(chart.kind) }];
  return (
    <section className={`tile${selected ? ' selected' : ''}`} style={{ gridColumn: `span ${size.span}`, height: size.height }}
      aria-label={chart.title}>
      <header>
        <button className="tile-title" onClick={() => canvas.select(selected ? null : chart.id)} aria-pressed={selected}
          title={selected ? 'Selected. Click to clear.' : 'Select this chart'}>{chart.title}</button>
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
          <button className="ib" onClick={() => canvas.remove(chart.id)} aria-label={`Remove ${chart.title}`}><CloseIcon /></button>
        </div>
      </header>
      {/* Keyed by kind so a type change replays the reveal. */}
      <div className="body reveal" key={chart.kind}>
        {!check.ok ? <p className="notice">{check.reason}</p>
          : check.empty ? <p className="notice">No rows match this query.</p>
          : <ChartView data={check.data} color={color} title={chart.title} />}
      </div>
      <footer>
        <span title={result?.aggregation}>{result ? `${result.aggregation} · ${formatTime(result.capturedAt)}` : chart.queryId}</span>
        <span>
          {result?.truncated && <span className="tag warn" title="The query limit cut off some rows">truncated</span>}{' '}
          {selected ? 'this chart' : freshness ?? ''}
        </span>
      </footer>
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
      <footer><span>querying…</span><span>{kindLabel(tile.kind)}</span></footer>
    </section>
  );
}
