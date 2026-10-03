import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import type { Dataset } from '../../shared/data.js';
import { formatTime } from '../canvas/format.js';
import type { CanvasState } from '../canvas/useCanvas.js';
import { ApiIcon, ArrowRightIcon, CloseIcon, DatabaseIcon, RefreshIcon, SparkIcon, UploadIcon } from './icons.js';

const freshnessWord: Record<Dataset['freshness'], string> = { snapshot: 'snapshot', live: 'live', sample: 'synthetic' };

/** Compact summary used on the canvas once a source is connected. */
export function DatasetSummary({ dataset }: { dataset: Dataset }) {
  return (
    <>
      <span className="ds-meta">{dataset.rowCount.toLocaleString('en-US')} rows · {freshnessWord[dataset.freshness]} {formatTime(dataset.capturedAt)}</span>
      <ul className="schema" aria-label={`Columns in ${dataset.name}`}>
        {dataset.columns.map(c => <li key={c.name}><span>{c.name}</span><span className="schema-type">{c.type}</span></li>)}
      </ul>
    </>
  );
}

function Tile({ label, title, color, onClick, disabled, busy, active, index, children }:
  { label: string; title: string; color: string; onClick?: () => void; disabled?: boolean; busy?: boolean; active?: boolean; index: number; children: ReactNode }) {
  return (
    <button className={`src-tile${busy ? ' busy' : ''}${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} title={title}
      aria-label={title} aria-pressed={active} style={{ ['--tint' as string]: color, animationDelay: `${index * 0.05}s` }}>
      <span className="src-circle">
        {busy && <span className="spin-ring" aria-hidden="true" />}
        <span className={busy ? 'fog' : undefined} style={{ display: 'flex' }}>{children}</span>
      </span>
      <span className="src-label">{label}</span>
    </button>
  );
}

type Connector = 'postgres' | 'api';

function ConnectForm({ canvas, kind, onDone }: { canvas: CanvasState; kind: Connector; onDone: () => void }) {
  const [sourceId, setSourceId] = useState('');
  const [token, setToken] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, [kind]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await canvas.connectSource(sourceId, token)) { setToken(''); onDone(); }
  };
  const valid = /^[A-Za-z0-9_-]{1,80}$/.test(sourceId.trim()) && token.trim().length >= 32;
  return (
    <form className="connect" onSubmit={submit} aria-label={kind === 'postgres' ? 'Connect Postgres source' : 'Connect API source'}>
      <input ref={first} value={sourceId} onChange={e => setSourceId(e.target.value)} placeholder="Source ID" aria-label="Source ID"
        autoComplete="off" spellCheck={false} maxLength={80} />
      <input value={token} onChange={e => setToken(e.target.value)} placeholder="Access token" aria-label="Access token"
        type="password" autoComplete="off" maxLength={512} />
      <button className="go" type="submit" disabled={!valid || canvas.connecting} aria-label="Connect" title="Connect">
        {canvas.connecting ? <span className="spin-ring small" aria-hidden="true" /> : <ArrowRightIcon />}
      </button>
    </form>
  );
}

/**
 * Icon-first source choices, shared by the empty canvas and the sources popover.
 * The whole group accepts a dropped workbook.
 */
export function SourceTiles({ canvas, onPicked }: { canvas: CanvasState; onPicked?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [connector, setConnector] = useState<Connector | null>(null);
  const noServerData = canvas.serverData === 'unavailable' || canvas.serverData === 'unreachable';
  const take = (file: File | undefined) => { if (file && !canvas.importing) void canvas.importFile(file); };
  const drop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); };
  const toggle = (kind: Connector) => setConnector(c => (c === kind ? null : kind));
  const choice = canvas.sheetChoice;
  return (
    <div className={`src-group${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)} onDrop={drop}>
      <input ref={input} type="file" accept=".xlsx,.csv" hidden
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; take(file); }} />
      <div className="src-tiles">
        <Tile label={over ? 'Drop' : 'File'} title="Upload or drop an .xlsx or .csv file (up to 256 KB)" color="#3DD6A3"
          index={0} busy={!!canvas.importing} disabled={!!canvas.importing} onClick={() => input.current?.click()}>
          <UploadIcon />
        </Tile>
        <Tile label="Postgres" title={noServerData ? 'Postgres needs the data service' : 'Connect a configured read-only Postgres source'}
          color="#5B8CFF" index={1} disabled={noServerData} active={connector === 'postgres'} onClick={() => toggle('postgres')}>
          <DatabaseIcon size={22} />
        </Tile>
        <Tile label="API" title={noServerData ? 'APIs need the data service' : 'Connect a configured HTTPS JSON source'}
          color="#E7C26A" index={2} disabled={noServerData} active={connector === 'api'} onClick={() => toggle('api')}>
          <ApiIcon />
        </Tile>
        {noServerData && (
          <Tile label="Sample" title="Synthetic sample data (this server has no data engine)" color="#C77DFF" index={3}
            onClick={() => { void canvas.loadSample(); onPicked?.(); }}>
            <SparkIcon />
          </Tile>
        )}
      </div>
      {choice && (
        <div className="sheets" role="group" aria-label={`Sheets in ${choice.name}`}>
          {choice.sheets.map((sheet, i) => (
            <button key={sheet} className="sheet-chip" style={{ animationDelay: `${i * 0.04}s` }} disabled={!!canvas.importing}
              onClick={() => void canvas.chooseSheet(sheet)}>{sheet}</button>
          ))}
          <button className="ghost" onClick={() => void canvas.chooseSheet(null)} aria-label="Cancel" title="Cancel"><CloseIcon size={13} /></button>
        </div>
      )}
      {connector && !choice && <ConnectForm canvas={canvas} kind={connector} onDone={() => { setConnector(null); onPicked?.(); }} />}
    </div>
  );
}

/** Popover above the sources button: connected datasets plus the same tiles. */
export function SourcesPanel({ canvas, onClose }: { canvas: CanvasState; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  // Focus the panel itself so keyboard users land inside without a ring on the first row.
  useEffect(() => { panel.current?.focus(); }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="popover src-pop" role="dialog" aria-label="Sources" tabIndex={-1}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        {canvas.datasets.length > 0 && (
          <ul className="ds-list" aria-label="Connected">
            {canvas.datasets.map(d => {
              const active = canvas.activeDataset?.id === d.id;
              const state = canvas.sourceState[d.id];
              return (
                <li key={d.id} className="ds-item">
                  <button className="ds-row" aria-pressed={active} onClick={() => canvas.setActiveId(d.id)}
                    title={`${d.rowCount.toLocaleString('en-US')} rows · ${d.columns.length} columns · ${freshnessWord[d.freshness]} ${formatTime(d.capturedAt)}${state === 'failed' ? ' · last refresh failed' : ''}`}>
                    <span className={`ds-dot${state === 'failed' ? ' failed' : active ? ' on' : ''}`} aria-hidden="true" />
                    <span className="ds-name">{d.name}</span>
                    <span className="ds-size">{d.rowCount.toLocaleString('en-US')}×{d.columns.length}</span>
                  </button>
                  {d.freshness === 'live' && (
                    <button className={`ds-refresh${state === 'refreshing' ? ' spinning' : ''}`} onClick={() => void canvas.refreshDataset(d.id)}
                      disabled={state === 'refreshing'} aria-label={`Refresh ${d.name}`} title="Refresh">
                      <RefreshIcon />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <SourceTiles canvas={canvas} onPicked={onClose} />
      </div>
    </>
  );
}
