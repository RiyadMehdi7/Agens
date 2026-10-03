import { base64ToFloat, floatToInt16, inputRate, int16ToBase64, level, outputRate, Resampler } from './pcm.js';

const workletSource = `
class AgensCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('agens-capture', AgensCapture);
`;

export class MicDeniedError extends Error {}

/** Microphone → 16 kHz 16-bit PCM chunks (~40 ms), plus an input level for the UI. */
export class MicCapture {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private pending: number[] = [];

  constructor(private readonly onChunk: (base64: string) => void, private readonly onLevel: (value: number) => void) {}

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
      if ((error as DOMException)?.name === 'NotAllowedError' || (error as DOMException)?.name === 'SecurityError') throw new MicDeniedError();
      throw error;
    }
    this.context = new AudioContext();
    const url = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    try { await this.context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'agens-capture');
    const resampler = new Resampler(this.context.sampleRate, inputRate);
    const chunk = inputRate / 25;
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.onLevel(level(e.data));
      for (const s of resampler.push(e.data)) this.pending.push(s);
      while (this.pending.length >= chunk) {
        this.onChunk(int16ToBase64(floatToInt16(Float32Array.from(this.pending.splice(0, chunk)))));
      }
    };
    source.connect(this.node);
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    void this.context?.close().catch(() => {});
    this.node = undefined; this.stream = undefined; this.context = undefined; this.pending = [];
    this.onLevel(0);
  }
}

/** 24 kHz PCM playback with gapless scheduling and instant stop on interruption. */
export class Player {
  private context?: AudioContext;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  constructor(private readonly onSpeaking: (speaking: boolean) => void) {}

  private ctx(): AudioContext {
    this.context ??= new AudioContext({ sampleRate: outputRate });
    return this.context;
  }

  /** Must run from a user gesture once so browsers allow playback. */
  async unlock(): Promise<void> { await this.ctx().resume(); }

  enqueue(base64: string): void {
    const ctx = this.ctx();
    const samples = base64ToFloat(base64);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, outputRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.next = Math.max(this.next, ctx.currentTime + 0.02);
    source.start(this.next);
    this.next += buffer.duration;
    this.sources.add(source);
    this.onSpeaking(true);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.onSpeaking(false);
    };
  }

  /** Drop everything queued: used when the user interrupts the model. */
  interrupt(): void {
    for (const source of this.sources) { try { source.stop(); } catch { /* already ended */ } }
    this.sources.clear();
    this.next = 0;
    this.onSpeaking(false);
  }

  close(): void {
    this.interrupt();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
