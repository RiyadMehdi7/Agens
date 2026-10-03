import type { FunctionResponseScheduling, LiveConnectConfig, LiveServerMessage, Session } from '@google/genai';
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

/**
 * One voice conversation with Gemini 3.8 Live. The browser talks to Live directly with a
 * single-use ephemeral token; the permanent key never reaches the page.
 */
export class VoiceSession {
  private session?: Session;
  private mic?: MicCapture;
  private player: Player;
  private handle?: string;
  private stopped = true;
  private attempts = 0;
  private speaking = false;
  private userText = '';
  private agentText = '';
  private cancelled = new Set<string>();

  constructor(private readonly h: VoiceHandlers) {
    this.player = new Player(speaking => { this.speaking = speaking; if (!this.stopped) this.h.onState(speaking ? 'speaking' : 'listening'); });
  }

  get active(): boolean { return !this.stopped; }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    this.h.onState('connecting');
    try {
      await this.player.unlock();
      // Token first: a server, quota or configuration problem fails fast, before any microphone prompt.
      const token = await this.h.getToken();
      this.mic = new MicCapture(data => this.session?.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } }), v => this.h.onLevel(v));
      await this.mic.start();
      if (this.stopped) return;
      await this.connect(token);
    } catch (error) {
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
    this.stopped = true;
    this.mic?.stop(); this.mic = undefined;
    this.player.interrupt();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = undefined;
    this.handle = undefined;
    this.h.onLevel(0);
  }

  private async connect(existing?: LiveTokenResponse): Promise<void> {
    // Tokens are single-use, so every reconnect asks the server for a fresh one.
    const token = existing ?? await this.h.getToken();
    // Loaded on demand so the canvas does not pay for the SDK until someone talks.
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: token.token });
    const config = { ...liveConnectConfig(), sessionResumption: this.handle ? { handle: this.handle } : {} };
    this.session = await ai.live.connect({
      model: token.model,
      // Shared config spells SDK enums as their string values so it stays importable without the SDK.
      config: config as unknown as LiveConnectConfig,
      callbacks: {
        onopen: () => { this.attempts = 0; this.h.onState(this.speaking ? 'speaking' : 'listening'); },
        onmessage: message => this.receive(message),
        onerror: () => { /* onclose follows and decides whether to reconnect */ },
        onclose: () => this.closed(),
      },
    });
  }

  private closed(): void {
    this.session = undefined;
    if (this.stopped) return;
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
      if (this.stopped) return;
      this.connect().catch(() => this.closed());
    }, wait);
  }

  private receive(message: LiveServerMessage): void {
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
        if (this.cancelled.delete(id) || !this.session) return;
        // WHEN_IDLE: the result joins the conversation without cutting off whatever the model is saying.
        this.session.sendToolResponse({ functionResponses: [{ id, name, response, scheduling: 'WHEN_IDLE' as FunctionResponseScheduling }] });
      });
    }
  }
}

function message(error: unknown): string {
  // Server failures are already user-safe (quota, model unavailable, not configured).
  if (error instanceof ApiFailure) return error.code === 'NOT_IMPLEMENTED' ? 'Voice is not configured on this server.' : error.message;
  return 'Voice could not start. Check the connection and try again.';
}
