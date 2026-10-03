import { useCallback, useEffect, useRef, useState } from 'react';
import { http, type CanvasState } from '../canvas/useCanvas.js';
import { VoiceSession, type VoiceState } from './session.js';
import { createToolRunner } from './tools.js';

export interface Caption { who: 'user' | 'agent'; text: string; final: boolean }

/** Wires a Gemini Live conversation to the canvas. One session per page; tap the mic to start or stop. */
export function useVoice(canvas: CanvasState) {
  const latest = useRef(canvas);
  latest.current = canvas;
  const [state, setState] = useState<VoiceState>('off');
  const [detail, setDetail] = useState<string | undefined>();
  const [caption, setCaption] = useState<Caption | null>(null);
  const [level, setLevel] = useState(0);
  const session = useRef<VoiceSession | null>(null);

  if (!session.current) {
    const tools = createToolRunner(() => latest.current);
    session.current = new VoiceSession({
      onState: (next, why) => { setState(next); setDetail(why); if (next === 'off') setCaption(null); },
      onLevel: value => setLevel(prev => (Math.abs(prev - value) > 0.02 ? value : prev)),
      onTranscript: (who, text, final) => setCaption({ who, text, final }),
      onToolCall: call => tools.run(call),
      onToolCancel: ids => tools.cancel(ids),
      getToken: () => http.liveToken(),
    });
  }

  useEffect(() => () => session.current?.stop(), []);

  const toggle = useCallback(() => {
    const s = session.current!;
    if (s.active) s.stop();
    else void s.start();
  }, []);

  return { state, detail, caption, level, toggle };
}
