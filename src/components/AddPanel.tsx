import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chart } from '../../shared/dashboard.js';
import type { Aggregate } from '../canvas/plan.js';
import { kindLabel, supportedKinds } from '../canvas/registry.js';
import type { CanvasState } from '../canvas/useCanvas.js';
import { KindIcon } from './icons.js';

const ops: { op: Aggregate; label: string }[] = [
  { op: 'sum', label: 'Sum' }, { op: 'avg', label: 'Average' }, { op: 'count', label: 'Count' },
  { op: 'min', label: 'Min' }, { op: 'max', label: 'Max' },
];
const oneCategory: Chart['kind'][] = ['line', 'area', 'bar', 'pie', 'treemap'];
const twoCategories: Chart['kind'][] = ['heatmap', 'sankey'];
const secondLabel: Partial<Record<Chart['kind'], [string, string]>> = { heatmap: ['Rows', 'Columns'], sankey: ['From', 'To'] };

function Select({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="pick">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function AddPanel({ canvas, onClose }: { canvas: CanvasState; onClose: () => void }) {
  const dataset = canvas.activeDataset;
  const columns = dataset?.columns ?? [];
  const numeric = useMemo(() => columns.filter(c => c.type === 'number'), [columns]);
  const categories = useMemo(() => columns.filter(c => c.type !== 'number' || numeric.length > 1), [columns, numeric.length]);
  const preferred = (type: 'date' | 'string', skip?: string) =>
    (categories.find(c => c.type === type && c.name !== skip) ?? categories.find(c => c.name !== skip) ?? categories[0])?.name ?? '';
  const [kind, setKind] = useState<Chart['kind']>('line');
  const [dimension, setDimension] = useState(preferred('date'));
  const [dimension2, setDimension2] = useState(preferred('string', preferred('date')));
  const [measure, setMeasure] = useState(numeric[0]?.name ?? '');
  const [op, setOp] = useState<Aggregate>(numeric.length ? 'sum' : 'count');
  const [x, setX] = useState(numeric[0]?.name ?? '');
  const [y, setY] = useState(numeric[1]?.name ?? numeric[0]?.name ?? '');
  const [picked, setPicked] = useState<string[]>(columns.slice(0, 4).map(c => c.name));
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const pickKind = (next: Chart['kind']) => {
    setKind(next);
    if (next === 'line' || next === 'area') setDimension(preferred('date'));
    else if (oneCategory.includes(next)) setDimension(preferred('string'));
    if (next === 'heatmap') { const a = preferred('string'); setDimension(a); setDimension2(preferred('date', a)); }
    if (next === 'sankey') { const a = preferred('string'); setDimension(a); setDimension2(preferred('string', a)); }
  };
  const submit = () => {
    void canvas.addChart({ kind, dimension, dimension2, measure, op, x, y, columns: picked });
    onClose();
  };
  const escape = (e: React.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  if (!dataset) {
    return <div className="popover" role="dialog" aria-label="Add a chart" onKeyDown={escape}><p className="soon" style={{ margin: 0 }}>Connect a source first.</p></div>;
  }
  const colOptions = (list: typeof columns) => list.map(c => ({ value: c.name, label: c.name }));
  const canScatter = numeric.length >= 2;
  return (
    <div className="popover add-pop" role="dialog" aria-label={`Add a chart from ${dataset.name}`} onKeyDown={escape}>
      <div className="kind-grid" role="radiogroup" aria-label="Chart type">
        {supportedKinds.map(({ kind: k }, i) => {
          const off = k === 'scatter' && !canScatter;
          return (
            <button key={k} ref={i === 0 ? first : undefined} role="radio" aria-checked={kind === k} className="kind-btn"
              onClick={() => pickKind(k)} disabled={off} title={off ? 'Needs two numeric columns' : kindLabel(k)} aria-label={kindLabel(k)}
              style={{ animationDelay: `${i * 0.025}s` }}>
              <KindIcon kind={k} />
            </button>
          );
        })}
      </div>
      <div className="kind-name">{kindLabel(kind)}</div>

      {kind === 'table' && (
        <div className="checks" role="group" aria-label="Columns">
          {columns.map(c => (
            <label className={`check${picked.includes(c.name) ? ' on' : ''}`} key={c.name}>
              <input type="checkbox" checked={picked.includes(c.name)}
                onChange={e => setPicked(p => e.target.checked ? [...p, c.name].slice(0, 8) : p.filter(v => v !== c.name))} />
              {c.name}
            </label>
          ))}
        </div>
      )}
      {kind === 'scatter' && (
        <div className="picks">
          <Select label="X" value={x} onChange={setX} options={colOptions(numeric)} />
          <Select label="Y" value={y} onChange={setY} options={colOptions(numeric)} />
        </div>
      )}
      {kind !== 'table' && kind !== 'scatter' && (
        <div className="picks">
          {oneCategory.includes(kind) && <Select label="By" value={dimension} onChange={setDimension} options={colOptions(categories)} />}
          {twoCategories.includes(kind) && (
            <>
              <Select label={secondLabel[kind]![0]} value={dimension} onChange={setDimension} options={colOptions(categories)} />
              <Select label={secondLabel[kind]![1]} value={dimension2} onChange={setDimension2} options={colOptions(categories)} />
            </>
          )}
          <Select label="Show" value={op} onChange={v => setOp(v as Aggregate)}
            options={ops.filter(o => o.op === 'count' || numeric.length).map(o => ({ value: o.op, label: o.label }))} />
          {op !== 'count' && <Select label="Of" value={measure} onChange={setMeasure} options={colOptions(numeric)} />}
        </div>
      )}
      <button className="btn primary" onClick={submit} disabled={kind === 'table' && picked.length === 0}>Add</button>
    </div>
  );
}
