import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Dataset } from '../../shared/data.js';
import { formatTime } from '../canvas/format.js';
import type { CanvasState } from '../canvas/useCanvas.js';
import { ApiIcon, DatabaseIcon, LayersIcon, SparkIcon, UploadIcon } from './icons.js';

/** Compact summary used on the canvas once a source is connected. */
export function DatasetSummary({ dataset }: { dataset: Dataset }) {
  return (
    <>
      <span className="ds-meta">
        {dataset.rowCount.toLocaleString('en-US')} rows · {dataset.freshness === 'sample' ? 'synthetic' : dataset.freshness} {formatTime(dataset.capturedAt)}
      </span>
      <ul className="schema" aria-label={`Columns in ${dataset.name}`}>
        {dataset.columns.map(c => <li key={c.name}><span>{c.name}</span><span className="schema-type">{c.type}</span></li>)}
      </ul>
    </>
  );
}

function Tile({ label, title, color, onClick, disabled, busy, children }:
  { label: string; title: string; color: string; onClick?: () => void; disabled?: boolean; busy?: boolean; children: ReactNode }) {
  return (
    <button className={`src-tile${busy ? ' busy' : ''}`} onClick={onClick} disabled={disabled} title={title}
      aria-label={title} style={{ ['--tint' as string]: color }}>
      {busy && <span className="orb" style={{ background: color }} aria-hidden="true" />}
      <span className={`src-icon${busy ? ' fog' : ''}`}>{children}</span>
      <span className="src-label">{label}</span>
    </button>
  );
}

/**
 * Icon-first source choices, shared by the empty canvas and the sources popover.
 * The whole group accepts a dropped workbook.
 */
export function SourceTiles({ canvas, onPicked, sheetPicker = false }: { canvas: CanvasState; onPicked?: () => void; sheetPicker?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [sheet, setSheet] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const noServerData = canvas.serverData === 'unavailable' || canvas.serverData === 'unreachable';
  const take = (file: File | undefined) => { if (file && !canvas.importing) void canvas.importFile(file, sheet); };
  const drop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); };
  return (
    <div className={`src-group${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)} onDrop={drop}>
      <input ref={input} type="file" accept=".xlsx,.csv" hidden
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; take(file); }} />
      <div className="src-tiles">
        <Tile label={over ? 'Drop' : 'File'} title="Upload or drop an .xlsx or .csv file (up to 256 KB)" color="#3DD6A3"
          busy={!!canvas.importing} disabled={!!canvas.importing} onClick={() => input.current?.click()}>
          <UploadIcon />
        </Tile>
        <Tile label="Postgres" title="Read-only Postgres — coming soon" color="#5B8CFF" disabled><DatabaseIcon size={22} /></Tile>
        <Tile label="API" title="HTTPS JSON API — coming soon" color="#E7C26A" disabled><ApiIcon /></Tile>
        {noServerData && (
          <Tile label="Sample" title="Synthetic sample data (this server has no data engine)" color="#C77DFF"
            onClick={() => { void canvas.loadSample(); onPicked?.(); }}>
            <SparkIcon />
          </Tile>
        )}
      </div>
      {sheetPicker && <div className="src-sheet">
        {sheetOpen ? (
          <input autoFocus value={sheet} maxLength={100} placeholder="Sheet name" aria-label="Excel sheet name"
            onChange={e => setSheet(e.target.value)} onBlur={() => { if (!sheet) setSheetOpen(false); }} />
        ) : (
          <button className="ghost" onClick={() => setSheetOpen(true)} title="Pick an Excel sheet (first sheet by default)" aria-label="Choose Excel sheet">
            <LayersIcon />
          </button>
        )}
      </div>}
    </div>
  );
}

/** Popover above the sources button: connected datasets plus the same tiles. */
export function SourcesPanel({ canvas, onClose }: { canvas: CanvasState; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="popover src-pop" role="dialog" aria-label="Sources"
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        {canvas.datasets.length > 0 && (
          <ul className="ds-list" aria-label="Connected">
            {canvas.datasets.map(d => {
              const active = canvas.activeDataset?.id === d.id;
              return (
                <li key={d.id}>
                  <button className="ds-row" aria-pressed={active} onClick={() => canvas.setActiveId(d.id)}
                    title={`${d.rowCount.toLocaleString('en-US')} rows · ${d.columns.length} columns · ${d.freshness} ${formatTime(d.capturedAt)}`}>
                    <span className={`ds-dot${active ? ' on' : ''}`} aria-hidden="true" />
                    <span className="ds-name">{d.name}</span>
                    <span className="ds-size">{d.rowCount.toLocaleString('en-US')}×{d.columns.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <SourceTiles canvas={canvas} onPicked={onClose} sheetPicker />
      </div>
    </>
  );
}
