import { useState } from 'react';
import { useCanvas } from './canvas/useCanvas.js';
import { useVoice } from './voice/useVoice.js';
import { AddPanel } from './components/AddPanel.js';
import { ChartTile, PendingChartTile } from './components/ChartTile.js';
import { DatabaseIcon, MicIcon, PlusIcon } from './components/icons.js';
import { DatasetSummary, SourcesPanel, SourceTiles } from './components/SourcesSheet.js';

const micLabel: Record<string, string> = {
  off: 'Talk to Agens', connecting: 'Connecting…', listening: 'Listening. Tap to stop', speaking: 'Agens is speaking. Tap to stop',
  reconnecting: 'Reconnecting…', denied: 'Microphone blocked', error: 'Voice stopped. Tap to retry',
};

export function App() {
  const canvas = useCanvas();
  const voice = useVoice(canvas);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { dashboard, activeDataset, pending } = canvas;
  const hasTiles = dashboard.charts.length > 0 || pending.length > 0;
  const busy = pending.length > 0 || !!canvas.importing;
  const voiceProblem = voice.state === 'denied' || voice.state === 'error';
  const onboarding = !activeDataset;
  const freshness = new Map(canvas.datasets.map(d => [d.id, d.freshness]));

  return (
    <div className="app">
      <main className="stage" aria-label="Canvas"
        onKeyDown={e => { if (e.key === 'Escape' && dashboard.selectedChartId) canvas.select(null); }}>
        {!activeDataset && !canvas.importing && (
          <div className="center">
            <h1 className="hero">What do you want to see?</h1>
            <SourceTiles canvas={canvas} />
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
                <span className="ds-dot on" title={activeDataset.freshness === 'sample' ? 'Synthetic sample data' : 'Connected'}
                  aria-label={activeDataset.freshness === 'sample' ? 'Synthetic sample data' : 'Connected'} />
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
        {/* While talking, the line above the mic is a live caption; otherwise it carries canvas status. */}
        {voice.caption && voice.state !== 'off' ? (
          <p className={`status caption ${voice.caption.who}`} role="status" aria-live="polite" style={{ opacity: sheetOpen || addOpen ? 0 : 1 }}>
            {voice.caption.text}
          </p>
        ) : (
          <p className={`status${canvas.status?.tone === 'error' || voiceProblem ? ' error' : ''}`} role="status" aria-live="polite"
            style={{ opacity: sheetOpen || addOpen ? 0 : 1 }}>
            {voiceProblem ? voice.detail : canvas.status?.text ?? ''}
            {!voiceProblem && canvas.status?.action && (
              <button className="status-action" onClick={canvas.status.action.run}>{canvas.status.action.label}</button>
            )}
          </p>
        )}
        <div className="dock">
          {/* Until data is connected the canvas itself offers the sources, so the dock is just the mic. */}
          {!onboarding && <div className="dock-side" style={{ position: 'relative' }}>
            {sheetOpen && <SourcesPanel canvas={canvas} onClose={() => setSheetOpen(false)} />}
            <button className="round" onClick={() => { setAddOpen(false); setSheetOpen(o => !o); }} aria-label="Data sources" aria-expanded={sheetOpen}>
              <DatabaseIcon />
              <span className="dot" style={{ background: activeDataset ? 'var(--ok)' : '#4A4E58' }} />
            </button>
          </div>}
          <div className={`mic-wrap ${voice.state}`} style={{ ['--level' as string]: voice.level.toFixed(2) }}>
            {(voice.state === 'listening' || voice.state === 'speaking') && (
              <><span className="ring" aria-hidden="true" /><span className="ring r2" aria-hidden="true" /><span className="ring r3" aria-hidden="true" /></>
            )}
            {(busy || voice.state === 'connecting' || voice.state === 'reconnecting') && <span className="spin-ring" aria-hidden="true" />}
            {canvas.voiceReady ? (
              <button className="mic" onClick={voice.toggle} aria-pressed={voice.state !== 'off' && voice.state !== 'denied' && voice.state !== 'error'}
                aria-label={micLabel[voice.state]} title={micLabel[voice.state]}>
                <MicIcon />
              </button>
            ) : (
              <button className="mic" aria-disabled="true" aria-label="Voice is not available on this server"
                onClick={() => canvas.setStatus({ text: 'Voice is not configured on this server. Use + to add charts.', tone: 'info' })}>
                <MicIcon />
              </button>
            )}
          </div>
          {!onboarding && <div className="dock-side" style={{ position: 'relative' }}>
            {addOpen && <AddPanel canvas={canvas} onClose={() => setAddOpen(false)} />}
            <button className="round" onClick={() => { setSheetOpen(false); setAddOpen(o => !o); }} aria-label="Add a chart" aria-expanded={addOpen}><PlusIcon /></button>
          </div>}
        </div>
      </div>

    </div>
  );
}
