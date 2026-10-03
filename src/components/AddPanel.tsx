import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartDraft, Aggregate } from '../canvas/plan.js';
import { kindLabel, unsupportedKinds } from '../canvas/registry.js';
import type { CanvasState } from '../canvas/useCanvas.js';

const kinds: ChartDraft['kind'][] = ['line', 'bar', 'metric', 'table'];
const ops: { op: Aggregate; label: string }[] = [
  { op: 'sum', label: 'Sum' }, { op: 'avg', label: 'Average' }, { op: 'count', label: 'Count rows' },
  { op: 'min', label: 'Minimum' }, { op: 'max', label: 'Maximum' },
];

export function AddPanel({ canvas, onClose }: { canvas: CanvasState; onClose: () => void }) {
  const dataset = canvas.activeDataset;
  const columns = dataset?.columns ?? [];
  const numeric = useMemo(() => columns.filter(c => c.type === 'number'), [columns]);
  const categories = useMemo(() => columns.filter(c => c.type !== 'number' || numeric.length > 1), [columns, numeric.length]);
  const dateFirst = categories.find(c => c.type === 'date') ?? categories[0];
  const textFirst = categories.find(c => c.type === 'string') ?? categories[0];
  const [kind, setKind] = useState<ChartDraft['kind']>('line');
  const [dimension, setDimension] = useState(dateFirst?.name ?? '');
  const [measure, setMeasure] = useState(numeric[0]?.name ?? '');
  const [op, setOp] = useState<Aggregate>(numeric.length ? 'sum' : 'count');
  const [picked, setPicked] = useState<string[]>(columns.slice(0, 4).map(c => c.name));
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const pickKind = (next: ChartDraft['kind']) => {
    setKind(next);
    if (next === 'line' && dateFirst) setDimension(dateFirst.name);
    if (next === 'bar' && textFirst) setDimension(textFirst.name);
  };
  const submit = () => {
    void canvas.addChart({ kind, dimension, measure, op, columns: picked });
    onClose();
  };
  if (!dataset) {
    return (
      <div className="popover" role="dialog" aria-label="Add a chart" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <span className="label">Add a chart</span>
        <p className="soon" style={{ margin: 0 }}>Connect a source first.</p>
      </div>
    );
  }
  return (
    <div className="popover" role="dialog" aria-label="Add a chart" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <span className="label">Add a chart · {dataset.name}</span>
      <div className="kinds" role="group" aria-label="Chart type">
        {kinds.map((k, i) => (
          <button key={k} ref={i === 0 ? first : undefined} className="kind" aria-pressed={kind === k} onClick={() => pickKind(k)}>{kindLabel(k)}</button>
        ))}
      </div>
      <p className="soon" style={{ margin: 0 }}>Not available yet: {unsupportedKinds.map(k => kindLabel(k).toLowerCase()).join(', ')}.</p>

      {kind === 'table' ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>Columns (up to 8)</legend>
          <div className="checks">
            {columns.map(c => (
              <label className="check" key={c.name}>
                <input type="checkbox" checked={picked.includes(c.name)}
                  onChange={e => setPicked(p => e.target.checked ? [...p, c.name].slice(0, 8) : p.filter(x => x !== c.name))} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <>
          {kind !== 'metric' && (
            <label className="field-label">{kind === 'line' ? 'Along' : 'Grouped by'}
              <select className="field" value={dimension} onChange={e => setDimension(e.target.value)}>
                {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
              </select>
            </label>
          )}
          <label className="field-label">Measure
            <select className="field" value={op} onChange={e => setOp(e.target.value as Aggregate)}>
              {ops.filter(o => o.op === 'count' || numeric.length).map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
          </label>
          {op !== 'count' && (
            <label className="field-label">Of
              <select className="field" value={measure} onChange={e => setMeasure(e.target.value)}>
                {numeric.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      <button className="btn primary" onClick={submit} disabled={kind === 'table' && picked.length === 0}>Add {kindLabel(kind).toLowerCase()}</button>
    </div>
  );
}
