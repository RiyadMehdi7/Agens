import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Dataset } from '../../shared/data.js';
import { formatTime } from '../canvas/format.js';
import type { CanvasState } from '../canvas/useCanvas.js';
import { ApiIcon, CloseIcon, DatabaseIcon, SheetIcon, SparkIcon } from './icons.js';

const freshnessText: Record<Dataset['freshness'], string> = { snapshot: 'Snapshot', live: 'Live', sample: 'Synthetic sample' };

function datasetMeta(dataset: Dataset): string {
  return `${dataset.rowCount.toLocaleString('en-US')} rows · ${dataset.columns.length} columns · ${freshnessText[dataset.freshness]} ${formatTime(dataset.capturedAt)}`;
}

/** Compact summary used on the canvas once a source is connected. */
export function DatasetSummary({ dataset }: { dataset: Dataset }) {
  return (
    <>
      <span className="ds-meta">{datasetMeta(dataset)}</span>
      <Schema dataset={dataset} />
    </>
  );
}

function Schema({ dataset }: { dataset: Dataset }) {
  return (
    <ul className="schema" aria-label={`Columns in ${dataset.name}`}>
      {dataset.columns.map(c => (
        <li key={c.name}><span>{c.name}</span><span className="schema-type">{c.type}</span></li>
      ))}
    </ul>
  );
}

function Glyph({ color, children }: { color: string; children: ReactNode }) {
  return <span className="glyph" style={{ background: `${color}14`, borderColor: `${color}2e`, color }}>{children}</span>;
}

export function FilePicker({ canvas, sheet, children, className }:
  { canvas: CanvasState; sheet?: string; children: ReactNode; className: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept=".xlsx,.csv" hidden
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void canvas.importFile(file, sheet); }} />
      <button className={className} onClick={() => input.current?.click()} disabled={!!canvas.importing}>{children}</button>
    </>
  );
}

function DropZone({ canvas }: { canvas: CanvasState }) {
  const [sheet, setSheet] = useState('');
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !canvas.importing) void canvas.importFile(file, sheet);
  };
  const active = over || !!canvas.importing;
  return (
    <div className={`dropzone${active ? ' active' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      {active && <div className="orb" style={{ background: '#3DD6A3' }} aria-hidden="true" />}
      <div className={`dropzone-body${canvas.importing ? ' fog' : ''}`}>
        <Glyph color="#3DD6A3"><SheetIcon /></Glyph>
        <p className="dz-title">{canvas.importing ? `Reading ${canvas.importing}` : over ? 'Release to upload' : 'Drop a workbook'}</p>
        <p className="dz-sub">
          or <FilePicker canvas={canvas} sheet={sheet} className="link">browse files</FilePicker> · .xlsx or .csv, up to 256 KB
        </p>
      </div>
      <label className="dz-sheet">
        <span>Sheet</span>
        <input value={sheet} maxLength={100} onChange={e => setSheet(e.target.value)} placeholder="First sheet" aria-label="Sheet name for .xlsx files" />
      </label>
    </div>
  );
}

export function SourcesSheet({ canvas, onClose }: { canvas: CanvasState; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  const noServerData = canvas.serverData === 'unavailable' || canvas.serverData === 'unreachable';
  let delay = 0;
  const stagger = () => ({ animationDelay: `${(delay += 0.04)}s` });
  return (
    <div className="overlay" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sources-title">
        <header className="sheet-head">
          <div>
            <h2 id="sources-title" className="sheet-title">Sources</h2>
            <p className="sheet-sub">Read-only. Data stays in this session.</p>
          </div>
          <button ref={close} className="ib" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>

        {canvas.datasets.length > 0 && (
          <section className="group">
            <h3 className="group-label">Connected</h3>
            <ul className="rows">
              {canvas.datasets.map(d => {
                const active = canvas.activeDataset?.id === d.id;
                return (
                  <li key={d.id} className="rise" style={stagger()}>
                    <button className="row-btn" aria-pressed={active} onClick={() => canvas.setActiveId(d.id)}>
                      <Glyph color={d.freshness === 'sample' ? '#C77DFF' : '#3DD6A3'}>
                        {d.freshness === 'sample' ? <SparkIcon /> : <SheetIcon />}
                      </Glyph>
                      <span className="row-main">
                        <span className="row-name">{d.name}</span>
                        <span className="ds-meta">{datasetMeta(d)}</span>
                      </span>
                      <span className={`state${active ? ' on' : ''}`}>{active ? 'In use' : 'Use'}</span>
                    </button>
                    {active && <Schema dataset={d} />}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="group rise" style={stagger()}>
          <h3 className="group-label">Add a source</h3>
          <DropZone canvas={canvas} />
        </section>

        <section className="group">
          <ul className="rows">
            <li className="rise" style={stagger()}>
              <div className="row-btn muted" aria-disabled="true">
                <Glyph color="#5B8CFF"><DatabaseIcon size={18} /></Glyph>
                <span className="row-main">
                  <span className="row-name">Postgres</span>
                  <span className="ds-meta">Read-only role, approved schemas only</span>
                </span>
                <span className="state">Soon</span>
              </div>
            </li>
            <li className="rise" style={stagger()}>
              <div className="row-btn muted" aria-disabled="true">
                <Glyph color="#E7C26A"><ApiIcon /></Glyph>
                <span className="row-main">
                  <span className="row-name">HTTPS API</span>
                  <span className="ds-meta">Owner-approved origins, stored credentials</span>
                </span>
                <span className="state">Soon</span>
              </div>
            </li>
            {noServerData && (
              <li className="rise" style={stagger()}>
                <button className="row-btn" onClick={() => { void canvas.loadSample(); onClose(); }}>
                  <Glyph color="#C77DFF"><SparkIcon /></Glyph>
                  <span className="row-main">
                    <span className="row-name">Sample data</span>
                    <span className="ds-meta">{canvas.serverData === 'unreachable' ? 'API unreachable' : 'No data engine on this server'} · synthetic revenue</span>
                  </span>
                  <span className="state">Try</span>
                </button>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
