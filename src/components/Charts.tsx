import { useState, type PointerEvent } from 'react';
import { formatCell, formatNumber } from '../canvas/format.js';
import { barSpans, pieArcs, sankeyLayout, squarify } from '../canvas/geometry.js';
import type { RenderData } from '../canvas/registry.js';

type Of<K extends RenderData['kind']> = Extract<RenderData, { kind: K }>;
type Series = Of<'line' | 'area' | 'bar' | 'pie' | 'treemap'>;

/** Categorical colours for part-of-whole charts, starting from the tile's own colour. */
const categorical = ['#FF8A4C', '#5B8CFF', '#3DD6A3', '#E7C26A', '#C77DFF', '#F27BA8', '#7DD3FC', '#A3E635'];
function categories(base: string, n: number): string[] {
  const rest = categorical.filter(c => c.toLowerCase() !== base.toLowerCase());
  const list = [base, ...rest];
  // Beyond eight categories, repeat the hues at lower strength rather than inventing new ones.
  return Array.from({ length: n }, (_, i) => list[i % list.length]!);
}

function MetricView({ data, color }: { data: Of<'metric'>; color: string }) {
  const short = data.value === null ? '—' : formatNumber(data.value, Math.abs(data.value) >= 1_000_000);
  const exact = data.value === null ? 'no value' : formatNumber(data.value, false);
  return (
    <div className="metric">
      <strong>{short}</strong>
      {/* The exact figure stays visible whenever the headline is rounded. */}
      {short !== exact && <span className="mono" style={{ fontSize: 12, color }}>{exact}</span>}
    </div>
  );
}

function useNearest(n: number) {
  const [hover, setHover] = useState<number | null>(null);
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };
  return { hover, handlers: { onPointerMove, onPointerLeave: () => setHover(null) } };
}

function LineView({ data, color, title, filled }: { data: Series; color: string; title: string; filled: boolean }) {
  const n = data.points.length;
  const { hover, handlers } = useNearest(n);
  const values = data.points.map(p => p.y).filter((v): v is number => v !== null);
  const lo = Math.min(...values, filled ? 0 : Infinity), hi = Math.max(...values, filled ? 0 : -Infinity);
  const pad = filled ? (hi - lo) * 0.06 || 1 : (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  const min = filled && lo >= 0 ? 0 : lo - pad, max = hi + pad;
  const xy = data.points.map((p, i) => ({ x: n === 1 ? 50 : (i / (n - 1)) * 100, y: p.y === null ? null : 100 - ((p.y - min) / (max - min)) * 100 }));
  // Gaps (null values) break the line instead of inventing a value.
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const p of xy) {
    if (p.y === null) { if (current.length) segments.push(current); current = []; }
    else current.push({ x: p.x, y: p.y });
  }
  if (current.length) segments.push(current);
  const base = Math.min(100, Math.max(0, 100 - ((0 - min) / (max - min)) * 100));
  const fill = (seg: { x: number; y: number }[]) => `M${seg[0]!.x},${base} L${seg.map(p => `${p.x},${p.y}`).join(' L')} L${seg[seg.length - 1]!.x},${base} Z`;
  const labels = n <= 1 ? [0] : n <= 6 ? xy.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const h = hover === null ? null : { p: data.points[hover]!, at: xy[hover]! };
  return (
    <>
      <div className="plot" {...handlers}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
          aria-label={`${title}: ${filled ? 'area' : 'line'} chart of ${data.y} across ${n} values of ${data.x}`}>
          {segments.map((seg, i) => <path key={`f${i}`} d={fill(seg)} fill={color} fillOpacity={filled ? 0.28 : 0.1} />)}
          {segments.map((seg, i) => (
            <polyline key={i} points={seg.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {h && h.at.y !== null && (
          <>
            <div className="hover-dot" style={{ left: `${h.at.x}%`, top: `${h.at.y}%` }} />
            <div className="hover-tip" style={{ left: `${h.at.x}%`, top: `${h.at.y}%` }}>{formatCell(h.p.x)} · {formatCell(h.p.y, false)}</div>
          </>
        )}
      </div>
      <div className="axis" aria-hidden="true">
        {labels.map(i => <span key={i}>{formatCell(data.points[i]?.x ?? null)}</span>)}
      </div>
    </>
  );
}

function BarView({ data, color }: { data: Series; color: string }) {
  const { spans, zero } = barSpans(data.points.map(p => p.y));
  const signed = zero > 0;
  return (
    <div className="bars" role="list">
      {data.points.map((p, i) => {
        const span = spans[i];
        return (
          <div className="bar-row" role="listitem" key={i}>
            <span title={formatCell(p.x)}>{formatCell(p.x)}</span>
            <div className="bar-track">
              {signed && <span className="bar-zero" style={{ left: `${zero}%` }} aria-hidden="true" />}
              {span && (
                <div className={`bar-fill${span.negative ? ' negative' : ''}`} style={{ left: `${span.left}%`, width: `${span.width}%`,
                  background: color, opacity: (span.negative ? 0.55 : 1) - Math.min(i, 5) * 0.08, animationDelay: `${i * 0.06}s` }} />
              )}
            </div>
            <span>{formatCell(p.y)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DonutView({ data, color, title }: { data: Series; color: string; title: string }) {
  const values = data.points.map(p => p.y ?? 0);
  const total = values.reduce((a, v) => a + v, 0);
  const arcs = pieArcs(values);
  const colors = categories(color, values.length);
  const [hover, setHover] = useState<number | null>(null);
  const r = 40, c = 2 * Math.PI * r;
  const focus = hover ?? 0;
  return (
    <div className="donut">
      <div className="donut-ring">
        <svg viewBox="0 0 100 100" role="img" aria-label={`${title}: donut chart of ${data.y} across ${values.length} ${data.x} values`}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--raised)" strokeWidth="14" />
          {arcs.map((a, i) => a.length > 0 && (
            <circle key={i} className="donut-slice" cx="50" cy="50" r={r} fill="none" stroke={colors[i]} strokeWidth={hover === i ? 16 : 14}
              strokeDasharray={`${Math.max(0, a.length * c - (values.length > 1 ? 0.8 : 0))} ${c}`} strokeDashoffset={-a.start * c}
              transform="rotate(-90 50 50)" style={{ animationDelay: `${i * 0.05}s`, opacity: hover === null || hover === i ? 1 : 0.35 }}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
          ))}
        </svg>
        <div className="donut-centre">
          <strong>{formatCell(hover === null ? total : values[focus]!)}</strong>
          <span>{hover === null ? 'total' : `${Math.round((arcs[focus]!.length) * 100)}%`}</span>
        </div>
      </div>
      <ul className="legend">
        {data.points.map((p, i) => (
          <li key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}>
            <i style={{ background: colors[i] }} /><span>{formatCell(p.x)}</span><b>{formatCell(p.y)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TreemapView({ data, color }: { data: Series; color: string }) {
  const values = data.points.map(p => p.y ?? 0);
  const total = values.reduce((a, v) => a + v, 0) || 1;
  const rects = squarify(values, { x: 0, y: 0, w: 160, h: 100 });
  const max = Math.max(...values, 1);
  return (
    <div className="treemap" role="list">
      {rects.map((r, i) => r.w > 0 && (
        <div key={i} role="listitem" className="tm-cell" title={`${formatCell(data.points[i]!.x)} · ${formatCell(values[i]!, false)}`}
          style={{ left: `${(r.x / 160) * 100}%`, top: `${r.y}%`, width: `${(r.w / 160) * 100}%`, height: `${r.h}%`,
            background: color, ['--o' as string]: 0.25 + 0.75 * (values[i]! / max), animationDelay: `${i * 0.03}s` }}>
          {r.w > 18 && r.h > 14 && (
            <span><b>{formatCell(data.points[i]!.x)}</b>{Math.round((values[i]! / total) * 100)}%</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ScatterView({ data, color, title }: { data: Of<'scatter'>; color: string; title: string }) {
  const xs = data.points.map(p => p.x), ys = data.points.map(p => p.y);
  const range = (v: number[]) => { const lo = Math.min(...v), hi = Math.max(...v); const pad = (hi - lo) * 0.06 || 1; return [lo - pad, hi + pad] as const; };
  const [x0, x1] = range(xs), [y0, y1] = range(ys);
  const [hover, setHover] = useState<number | null>(null);
  const h = hover === null ? null : data.points[hover]!;
  const pos = (p: { x: number; y: number }) => ({ left: `${((p.x - x0) / (x1 - x0)) * 100}%`, top: `${100 - ((p.y - y0) / (y1 - y0)) * 100}%` });
  return (
    <>
      <div className="plot scatter" role="img" aria-label={`${title}: scatter plot of ${data.y} against ${data.x}, ${data.points.length} points`}>
        {data.points.map((p, i) => (
          <span key={i} className="dot" style={{ ...pos(p), background: color, animationDelay: `${Math.min(i, 60) * 0.01}s` }}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
        ))}
        <span className="y-note" aria-hidden="true">↑ {data.y} {formatCell(Math.min(...ys))}–{formatCell(Math.max(...ys))}</span>
        {h && <div className="hover-tip" style={pos(h)}>{data.x} {formatCell(h.x, false)} · {data.y} {formatCell(h.y, false)}</div>}
      </div>
      <div className="axis" aria-hidden="true"><span>{formatCell(Math.min(...xs))}</span><span>{data.x} →</span><span>{formatCell(Math.max(...xs))}</span></div>
    </>
  );
}

function HeatmapView({ data, color }: { data: Of<'heatmap'>; color: string }) {
  const values = data.cells.flat().filter((v): v is number => v !== null);
  const lo = Math.min(...values), hi = Math.max(...values);
  return (
    <div className="heat" style={{ gridTemplateColumns: `minmax(48px, max-content) repeat(${data.cols.length}, minmax(0, 1fr))` }}>
      {data.rows.map((row, r) => (
        <div key={row} className="heat-row">
          <span className="heat-label" title={row}>{row}</span>
          {data.cols.map((col, c) => {
            const v = data.cells[r]![c] ?? null;
            return (
              <span key={col} className="heat-cell" title={`${row} · ${col} · ${formatCell(v, false)}`}
                style={{ background: v === null ? 'transparent' : color, opacity: v === null ? 1 : 0.1 + 0.9 * ((v - lo) / (hi - lo || 1)),
                  outline: v === null ? '1px dashed var(--line)' : undefined, animationDelay: `${(r + c) * 0.015}s` }} />
            );
          })}
        </div>
      ))}
      <div className="heat-row heat-cols" aria-hidden="true">
        <span />
        {data.cols.map((col, c) => <span key={col} title={col}>{data.cols.length <= 12 || c % Math.ceil(data.cols.length / 8) === 0 ? col : ''}</span>)}
      </div>
    </div>
  );
}

function SankeyView({ data, color, title }: { data: Of<'sankey'>; color: string; title: string }) {
  const layout = sankeyLayout(data.links);
  const colors = categories(color, layout.left.length);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="sankey" role="img" aria-label={`${title}: flows from ${data.from} to ${data.to}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {layout.links.map((l, i) => {
          const a = `M3,${l.sy} C50,${l.sy} 50,${l.ty} 97,${l.ty} L97,${l.ty + l.th} C50,${l.ty + l.th} 50,${l.sy + l.sh} 3,${l.sy + l.sh} Z`;
          return <path key={i} d={a} fill={colors[l.source]} fillOpacity={hover === null ? 0.28 : hover === i ? 0.6 : 0.1}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <title>{`${layout.left[l.source]!.name} → ${layout.right[l.target]!.name} · ${formatCell(l.value, false)}`}</title>
          </path>;
        })}
        {layout.left.map((n, i) => <rect key={`l${i}`} x="0" y={n.y} width="3" height={Math.max(n.h, 0.5)} fill={colors[i]} />)}
        {layout.right.map((n, i) => <rect key={`r${i}`} x="97" y={n.y} width="3" height={Math.max(n.h, 0.5)} fill="var(--text-2)" />)}
      </svg>
      {layout.left.map((n, i) => n.h > 4 && <span key={`L${i}`} className="sk-label" style={{ top: `${n.y + n.h / 2}%`, left: '4%' }}>{n.name}</span>)}
      {layout.right.map((n, i) => n.h > 4 && <span key={`R${i}`} className="sk-label right" style={{ top: `${n.y + n.h / 2}%`, right: '4%' }}>{n.name}</span>)}
    </div>
  );
}

function TableView({ data }: { data: Of<'table'> }) {
  const numeric = new Set(data.columns.filter(c => data.rows.some(r => typeof r[c] === 'number')));
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{data.columns.map(c => <th key={c} className={numeric.has(c) ? 'num' : undefined}>{c}</th>)}</tr></thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>{data.columns.map(c => <td key={c} className={numeric.has(c) ? 'num' : undefined}>{formatCell(row[c] ?? null, false)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartView({ data, color, title }: { data: RenderData; color: string; title: string }) {
  switch (data.kind) {
    case 'metric': return <MetricView data={data} color={color} />;
    case 'line': return <LineView data={data} color={color} title={title} filled={false} />;
    case 'area': return <LineView data={data} color={color} title={title} filled />;
    case 'bar': return <BarView data={data} color={color} />;
    case 'pie': return <DonutView data={data} color={color} title={title} />;
    case 'treemap': return <TreemapView data={data} color={color} />;
    case 'scatter': return <ScatterView data={data} color={color} title={title} />;
    case 'heatmap': return <HeatmapView data={data} color={color} />;
    case 'sankey': return <SankeyView data={data} color={color} title={title} />;
    case 'table': return <TableView data={data} />;
  }
}

/** Blurred placeholder shown while a query or plan is still running. */
export function Ghost() {
  return <div className="ghost" aria-hidden="true">{[38, 52, 46, 64, 58, 72, 66, 84].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>;
}
