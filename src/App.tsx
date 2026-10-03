import { useState } from 'react';
import { useCanvas } from './canvas/useCanvas.js';
import { AddPanel } from './components/AddPanel.js';
import { ChartTile, PendingChartTile } from './components/ChartTile.js';
import { ApiIcon, DatabaseIcon, MicIcon, PlusIcon, SheetIcon, SparkIcon } from './components/icons.js';
import { DatasetSummary, FilePicker, SourcesSheet } from './components/SourcesSheet.js';

export function App() {
  const canvas = useCanvas();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { dashboard, activeDataset, pending } = canvas;
  const hasTiles = dashboard.charts.length > 0 || pending.length > 0;
  const busy = pending.length > 0 || !!canvas.importing;
  const freshness = new Map(canvas.datasets.map(d => [d.id, d.freshness === 'sample' ? 'sample data' : d.freshness]));

  return (
    <div className="app">
      <main className="stage" aria-label="Canvas"
        onKeyDown={e => { if (e.key === 'Escape' && dashboard.selectedChartId) canvas.select(null); }}>
        {!activeDataset && !canvas.importing && (
          <div className="center">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h1 className="hero">What do you want to see?</h1>
              <p className="sub">Connect a source, then build your dashboard.</p>
            </div>
            <div className="sources">
              <FilePicker canvas={canvas} className="source">
                <SheetIcon color="#3DD6A3" /><strong>Excel or CSV</strong><span>Upload a workbook</span>
              </FilePicker>
              <button className="source" onClick={() => setSheetOpen(true)}>
                <DatabaseIcon color="#5B8CFF" size={22} /><strong>Database</strong><span>Read-only Postgres · not yet</span>
              </button>
              <button className="source" onClick={() => setSheetOpen(true)}>
                <ApiIcon color="#E7C26A" /><strong>API</strong><span>HTTPS JSON · not yet</span>
              </button>
              {(canvas.serverData === 'unavailable' || canvas.serverData === 'unreachable') && (
                <button className="source" onClick={() => void canvas.loadSample()}>
                  <SparkIcon color="#C77DFF" /><strong>Sample data</strong><span>Synthetic revenue, labelled</span>
                </button>
              )}
            </div>
          </div>
        )}

        {canvas.importing && !activeDataset && (
          <div className="center">
            <div className="card" style={{ position: 'relative', overflow: 'hidden' }} aria-busy="true">
              <div className="orb" style={{ background: '#3DD6A3' }} />
              <div className="fog" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontSize: 17 }}>{canvas.importing}</span>
                <div className="chips">{[80, 64, 96, 72].map((w, i) => <span key={i} className="chip" style={{ width: w, height: 24 }} />)}</div>
              </div>
            </div>
          </div>
        )}

        {activeDataset && !hasTiles && (
          <div className="center">
            <div className="card">
              <div className="row">
                <span style={{ fontSize: 17 }}>{activeDataset.name}</span>
                <span className="state on">{activeDataset.freshness === 'sample' ? 'Sample data' : 'Connected'}</span>
              </div>
              <DatasetSummary dataset={activeDataset} />
            </div>
            <p className="hero" style={{ color: 'var(--muted)', fontSize: 'clamp(20px, 2.4vw, 28px)' }}>Tap + to add a chart.</p>
          </div>
        )}

        {hasTiles && (
          <div className="grid">
            {dashboard.charts.map((chart, i) => (
              <ChartTile key={chart.id} chart={chart} result={canvas.results[chart.queryId]}
                layout={canvas.layout[chart.id] ?? { size: 1, color: 0 }} selected={dashboard.selectedChartId === chart.id}
                index={i} count={dashboard.charts.length} freshness={freshness.get(chart.datasetId)} canvas={canvas} />
            ))}
            {pending.map(tile => <PendingChartTile key={tile.key} tile={tile} />)}
          </div>
        )}
      </main>

      <div className="dock-area">
        <p className={`status${canvas.status?.tone === 'error' ? ' error' : ''}`} role="status" aria-live="polite">
          {canvas.status?.text ?? ''}
        </p>
        <div className="dock">
          <button className="round" onClick={() => { setAddOpen(false); setSheetOpen(true); }} aria-label="Data sources">
            <DatabaseIcon />
            <span className="dot" style={{ background: activeDataset ? 'var(--ok)' : '#4A4E58' }} />
          </button>
          <div style={{ position: 'relative' }}>
            {busy && <span className="spin-ring" aria-hidden="true" />}
            {/* Voice lands with issue #4; until then the control states that it is unavailable. */}
            <button className="mic" aria-disabled="true" aria-label="Voice, not connected yet"
              onClick={() => canvas.setStatus({ text: 'Voice is not connected yet. Use + to add charts for now.', tone: 'info' })}>
              <MicIcon />
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            {addOpen && <AddPanel canvas={canvas} onClose={() => setAddOpen(false)} />}
            <button className="round" onClick={() => setAddOpen(o => !o)} aria-label="Add a chart" aria-expanded={addOpen}><PlusIcon /></button>
          </div>
        </div>
      </div>

      {sheetOpen && <SourcesSheet canvas={canvas} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
