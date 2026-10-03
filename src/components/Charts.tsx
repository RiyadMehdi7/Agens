import { useState, type PointerEvent } from 'react';
import { formatCell, formatNumber } from '../canvas/format.js';
import { barSpans } from '../canvas/geometry.js';
import type { RenderData } from '../canvas/registry.js';

type Series = Extract<RenderData, { kind: 'line' | 'bar' }>;

function MetricView({ data, color }: { data: Extract<RenderData, { kind: 'metric' }>; color: string }) {
  const short = data.value === null ? '—' : formatNumber(data.value, Math.abs(data.value) >= 1_000_000);
  const exact = data.value === null ? 'no value' : formatNumber(data.value, false);
  return (
    <div className="metric">
      <strong>{short}</strong>
      {/* The exact figure stays visible whenever the headline is rounded. */}
      <span className="mono" style={{ fontSize: 12, color }}>{short === exact ? data.label : exact}</span>
    </div>
  );
}

function LineView({ data, color, title }: { data: Series; color: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.points.map(p => p.y).filter((v): v is number => v !== null);
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  const min = lo - pad, max = hi + pad;
  const n = data.points.length;
  const xy = data.points.map((p, i) => ({ x: n === 1 ? 50 : (i / (n - 1)) * 100, y: p.y === null ? null : 100 - ((p.y - min) / (max - min)) * 100 }));
  // Gaps (null values) break the line instead of inventing a value.
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of xy) {
    if (p.y === null) { if (current.length) segments.push(current.join(' ')); current = []; }
    else current.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  }
  if (current.length) segments.push(current.join(' '));
  const first = xy.findIndex(p => p.y !== null);
  const last = xy.length - 1 - [...xy].reverse().findIndex(p => p.y !== null);
  const area = segments.length === 1 && first >= 0
    ? `M${xy[first]!.x},100 L${segments[0]!.split(' ').join(' L')} L${xy[last]!.x},100 Z` : '';
  const labels = n <= 1 ? [0] : n <= 6 ? xy.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };
  const h = hover === null ? null : { p: data.points[hover]!, at: xy[hover]! };
  return (
    <>
      <div className="plot" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
          aria-label={`${title}: line chart of ${data.y} across ${n} values of ${data.x}`}>
          {area && <path d={area} fill={color} fillOpacity={0.1} />}
          {segments.map((pts, i) => (
            <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {h && h.at.y !== null && (
          <>
            <div className="hover-dot" style={{ left: `${h.at.x}%`, top: `${h.at.y}%` }} />
            <div className="hover-tip" style={{ left: `${h.at.x}%`, top: `${h.at.y}%` }}>
              {formatCell(h.p.x)} · {formatCell(h.p.y, false)}
            </div>
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

function TableView({ data }: { data: Extract<RenderData, { kind: 'table' }> }) {
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
    case 'line': return <LineView data={data} color={color} title={title} />;
    case 'bar': return <BarView data={data} color={color} />;
    case 'table': return <TableView data={data} />;
  }
}

/** Blurred placeholder shown while a query or plan is still running. */
export function Ghost() {
  return <div className="ghost" aria-hidden="true">{[38, 52, 46, 64, 58, 72, 66, 84].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>;
}
