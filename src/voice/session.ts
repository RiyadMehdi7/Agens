import type { FunctionResponse, FunctionResponseScheduling, LiveConnectConfig, LiveServerMessage, Session } from '@google/genai';
import { liveConnectConfig, type LiveTokenResponse } from '../../shared/voice.js';
import { ApiFailure } from '../api/errors.js';
import { MicCapture, MicDeniedError, Player } from './audio.js';

export type VoiceState = 'off' | 'connecting' | 'listening' | 'speaking' | 'reconnecting' | 'denied' | 'error';

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface VoiceHandlers {
  onState(state: VoiceState, detail?: string): void;
  onLevel(level: number): void;
  /** Live captions: the user's words and the model's spoken reply. */
  onTranscript(who: 'user' | 'agent', text: string, final: boolean): void;
  /** Executes a tool and returns its JSON result. Must not throw; errors become `{ error }` results. */
  onToolCall(call: ToolCall): Promise<Record<string, unknown>>;
  /** The model cancelled these in-flight tool calls (for example after the user changed their mind). */
  onToolCancel(ids: string[]): void;
  getToken(): Promise<LiveTokenResponse>;
}

const maxReconnects = 3;

type LiveCallbacks = { onopen(): void; onmessage(message: LiveServerMessage): void; onerror(): void; onclose(): void };
type LiveConnection = Pick<Session, 'sendRealtimeInput' | 'sendToolResponse' | 'close'>;
/** Browser integrations, injectable so the lifecycle can be tested without audio devices or the network. */
export interface VoiceDeps {
  mic(onChunk: (base64: string) => void, onLevel: (value: number) => void): Pick<MicCapture, 'start' | 'stop'>;
  player(onSpeaking: (speaking: boolean) => void): Pick<Player, 'unlock' | 'enqueue' | 'interrupt' | 'close'>;
  connect(token: LiveTokenResponse, config: LiveConnectConfig, callbacks: LiveCallbacks): Promise<LiveConnection>;
}
const browserDeps: VoiceDeps = {
  mic: (onChunk, onLevel) => new MicCapture(onChunk, onLevel),
  player: onSpeaking => new Player(onSpeaking),
  async connect(token, config, callbacks) {
    // Loaded on demand so the canvas does not pay for the SDK until someone talks.
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({ apiKey: token.token }).live.connect({ model: token.model, config, callbacks });
  },
};

/**
 * One voice conversation with Gemini 3.8 Live. The browser talks to Live directly with a
 * single-use ephemeral token; the permanent key never reaches the page.
 */
export class VoiceSession {
  private session?: LiveConnection;
  private mic?: Pick<MicCapture, 'start' | 'stop'>;
  private player: Pick<Player, 'unlock' | 'enqueue' | 'interrupt' | 'close'>;
  private handle?: string;
  private stopped = true;
  private attempts = 0;
  private speaking = false;
  private userText = '';
  private agentText = '';
  private cancelled = new Set<string>();
  /** Bumped on every start and stop. Async work from an older conversation checks it and backs out. */
  private generation = 0;
  /** Tool results finished while reconnecting; sent once the same conversation is connected again. */
  private outbox: FunctionResponse[] = [];

  constructor(private readonly h: VoiceHandlers, private readonly deps: VoiceDeps = browserDeps) {
    this.player = deps.player(speaking => { this.speaking = speaking; if (!this.stopped) this.h.onState(speaking ? 'speaking' : 'listening'); });
  }

  get active(): boolean { return !this.stopped; }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    const gen = ++this.generation;
    const stale = () => gen !== this.generation;
    this.h.onState('connecting');
    try {
      await this.player.unlock();
      // Token first: a server, quota or configuration problem fails fast, before any microphone prompt.
      const token = await this.h.getToken();
      if (stale()) return;
      const mic = this.deps.mic(data => { if (!stale()) this.session?.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } }); },
        v => { if (!stale()) this.h.onLevel(v); });
      await mic.start();
      // Stopped while the permission prompt or device start was pending: release the microphone at once.
      if (stale()) { mic.stop(); return; }
      this.mic = mic;
      await this.connect(gen, token);
    } catch (error) {
      if (stale()) return;
      const denied = error instanceof MicDeniedError;
      this.teardown();
      this.h.onState(denied ? 'denied' : 'error', denied ? 'Microphone access is blocked. Allow it in the browser to talk.' : message(error));
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.teardown();
    this.h.onState('off');
  }

  private teardown(): void {
    this.generation += 1;
    this.stopped = true;
    this.mic?.stop(); this.mic = undefined;
    this.player.interrupt();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = undefined;
    this.handle = undefined;
    this.outbox = [];
    this.cancelled.clear();
    this.h.onLevel(0);
  }

  private async connect(gen: number, existing?: LiveTokenResponse): Promise<void> {
    const stale = () => gen !== this.generation;
    // Tokens are single-use, so every reconnect asks the server for a fresh one.
    const token = existing ?? await this.h.getToken();
    if (stale()) return;
    const config = { ...liveConnectConfig(), sessionResumption: this.handle ? { handle: this.handle } : {} };
    // Shared config spells SDK enums as their string values so it stays importable without the SDK.
    const session = await this.deps.connect(token, config as unknown as LiveConnectConfig, {
      onopen: () => { if (stale()) return; this.attempts = 0; this.h.onState(this.speaking ? 'speaking' : 'listening'); },
      onmessage: message => { if (!stale()) this.receive(message, gen); },
      onerror: () => { /* onclose follows and decides whether to reconnect */ },
      onclose: () => { if (!stale()) this.closed(gen); },
    });
    // Stopped while connecting: never adopt a connection the user already turned off.
    if (stale()) { try { session.close(); } catch { /* closing anyway */ } return; }
    this.session = session;
    const queued = this.outbox.splice(0);
    if (queued.length) session.sendToolResponse({ functionResponses: queued });
  }

  private closed(gen: number): void {
    this.session = undefined;
    if (this.stopped || gen !== this.generation) return;
    this.player.interrupt();
    if (this.attempts >= maxReconnects) {
      this.teardown();
      this.h.onState('error', 'Voice disconnected. Tap the mic to start again.');
      return;
    }
    this.attempts += 1;
    this.h.onState('reconnecting');
    const wait = 400 * 2 ** (this.attempts - 1);
    setTimeout(() => {
      if (gen !== this.generation) return;
      this.connect(gen).catch(() => this.closed(gen));
    }, wait);
  }

  private receive(message: LiveServerMessage, gen: number): void {
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.handle = message.sessionResumptionUpdate.newHandle;
    }
    if (message.goAway) {
      // The server will close soon; move to a fresh connection now, resuming the same conversation.
      const old = this.session;
      this.session = undefined;
      try { old?.close(); } catch { /* closing anyway */ }
      return;
    }
    const content = message.serverContent;
    if (content?.interrupted) this.player.interrupt();
    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) this.player.enqueue(part.inlineData.data);
    }
    if (content?.inputTranscription?.text) {
      this.userText += content.inputTranscription.text;
      this.h.onTranscript('user', this.userText.trim(), false);
    }
    if (content?.outputTranscription?.text) {
      if (this.userText) { this.h.onTranscript('user', this.userText.trim(), true); this.userText = ''; }
      this.agentText += content.outputTranscription.text;
      this.h.onTranscript('agent', this.agentText.trim(), false);
    }
    if (content?.turnComplete || content?.interrupted) {
      if (this.agentText) this.h.onTranscript('agent', this.agentText.trim(), true);
      this.agentText = '';
    }
    if (message.toolCallCancellation?.ids?.length) {
      message.toolCallCancellation.ids.forEach(id => this.cancelled.add(id));
      this.h.onToolCancel(message.toolCallCancellation.ids);
    }
    for (const call of message.toolCall?.functionCalls ?? []) {
      if (!call.id || !call.name) continue;
      const id = call.id, name = call.name;
      void this.h.onToolCall({ id, name, args: (call.args ?? {}) as Record<string, unknown> }).then(response => {
        // Results belong to the conversation that asked. A stopped or restarted conversation never receives them.
        if (gen !== this.generation || this.cancelled.delete(id)) return;
        // WHEN_IDLE: the result joins the conversation without cutting off whatever the model is saying.
        const reply: FunctionResponse = { id, name, response, scheduling: 'WHEN_IDLE' as FunctionResponseScheduling };
        if (this.session) this.session.sendToolResponse({ functionResponses: [reply] });
        else this.outbox.push(reply);
      });
    }
  }
}

function message(error: unknown): string {
  // Server failures are already user-safe (quota, model unavailable, not configured).
  if (error instanceof ApiFailure) return error.code === 'NOT_IMPLEMENTED' ? 'Voice is not configured on this server.' : error.message;
  return 'Voice could not start. Check the connection and try again.';
}
