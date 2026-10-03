import { useEffect, useRef, useState } from 'react';
import type { Dataset } from '../../shared/data.js';
import { formatTime } from '../canvas/format.js';
import type { CanvasState } from '../canvas/useCanvas.js';
import { CloseIcon } from './icons.js';

const freshnessText: Record<Dataset['freshness'], string> = {
  snapshot: 'snapshot', live: 'live', sample: 'sample · synthetic',
};

export function DatasetSummary({ dataset }: { dataset: Dataset }) {
  return (
    <>
      <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
        {dataset.rowCount.toLocaleString('en-US')} rows · {dataset.columns.length} columns · {freshnessText[dataset.freshness]} {formatTime(dataset.capturedAt)}
      </span>
      <div className="chips" aria-label="Columns">
        {dataset.columns.map(c => <span className="chip" key={c.name}>{c.name}<em>{c.type}</em></span>)}
      </div>
    </>
  );
}

export function FilePicker({ canvas, sheet, children, className, id }:
  { canvas: CanvasState; sheet?: string; children: React.ReactNode; className: string; id?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} id={id} type="file" accept=".xlsx,.csv" hidden
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void canvas.importFile(file, sheet); }} />
      <button className={className} onClick={() => input.current?.click()} disabled={!!canvas.importing}>{children}</button>
    </>
  );
}

export function SourcesSheet({ canvas, onClose }: { canvas: CanvasState; onClose: () => void }) {
  const [sheet, setSheet] = useState('');
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  const noServerData = canvas.serverData === 'unavailable' || canvas.serverData === 'unreachable';
  return (
    <div className="overlay" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sources-title">
        <div className="row" style={{ alignItems: 'center' }}>
          <h2 id="sources-title" style={{ margin: 0, fontSize: 20, fontWeight: 400 }}>Data sources</h2>
          <button ref={close} className="ib" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>

        {canvas.datasets.length > 0 && (
          <section>
            <span className="label">Connected</span>
            {canvas.datasets.map(d => (
              <button key={d.id} className="dataset" aria-pressed={canvas.activeDataset?.id === d.id} onClick={() => canvas.setActiveId(d.id)}>
                <div>
                  <span style={{ fontSize: 15 }}>{d.name}</span>
                  {canvas.activeDataset?.id === d.id ? <DatasetSummary dataset={d} />
                    : <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{d.rowCount.toLocaleString('en-US')} rows</span>}
                </div>
                <span className={`tag${d.freshness === 'sample' ? ' sample' : ''}`}>{canvas.activeDataset?.id === d.id ? 'active' : d.freshness}</span>
              </button>
            ))}
          </section>
        )}

        <section>
          <span className="label" style={{ color: 'var(--ok)' }}>Excel / CSV</span>
          <label className="field-label">Sheet name (optional, .xlsx only; first sheet if empty)
            <input className="field" value={sheet} maxLength={100} onChange={e => setSheet(e.target.value)} placeholder="Sheet1" />
          </label>
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="soon">Up to 256 KB. Uploads are read-only snapshots.</span>
            <FilePicker canvas={canvas} sheet={sheet} className="btn primary">{canvas.importing ? 'Reading…' : 'Upload file'}</FilePicker>
          </div>
          {noServerData && (
            <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="soon">{canvas.serverData === 'unreachable' ? 'The API is not reachable.' : 'This server has no data engine yet.'} You can try the canvas with synthetic data.</span>
              <button className="btn" onClick={() => { void canvas.loadSample(); onClose(); }}>Use sample data</button>
            </div>
          )}
        </section>

        <section>
          <span className="label" style={{ color: '#5B8CFF' }}>Database · read-only</span>
          <p className="soon" style={{ margin: 0 }}>Read-only Postgres with an approved schema list. Not connected in this build yet.</p>
        </section>
        <section>
          <span className="label" style={{ color: '#E7C26A' }}>API · HTTPS JSON</span>
          <p className="soon" style={{ margin: 0 }}>Owner-approved HTTPS origins with stored credentials. Not connected in this build yet.</p>
        </section>
      </div>
    </div>
  );
}
