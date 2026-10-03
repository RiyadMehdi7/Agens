import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiveServerMessage } from '@google/genai';
import { VoiceSession, type VoiceDeps, type VoiceHandlers } from '../src/voice/session.js';

const tick = () => new Promise(r => setTimeout(r, 0));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

function harness() {
  const log: string[] = [];
  const gates = { token: deferred<void>(), mic: deferred<void>(), connect: deferred<void>() };
  const connections: { sent: unknown[]; closed: boolean; callbacks: Parameters<VoiceDeps['connect']>[2] }[] = [];
  const tools: Record<string, ReturnType<typeof deferred<Record<string, unknown>>>> = {};
  let open = { token: false, mic: false, connect: false };
  const deps: VoiceDeps = {
    mic: () => ({ start: async () => { log.push('mic:start'); if (!open.mic) await gates.mic.promise; }, stop: () => { log.push('mic:stop'); } }),
    player: () => ({ unlock: async () => {}, enqueue: () => {}, interrupt: () => {}, close: () => {} }),
    async connect(_token, _config, callbacks) {
      log.push('connect');
      if (!open.connect) await gates.connect.promise;
      const connection = { sent: [] as unknown[], closed: false, callbacks };
      connections.push(connection);
      return {
        sendRealtimeInput: () => {},
        sendToolResponse: (params: unknown) => { connection.sent.push(params); },
        close: () => { connection.closed = true; log.push('session:close'); },
      } as never;
    },
  };
  const states: string[] = [];
  const handlers: VoiceHandlers = {
    onState: s => states.push(s), onLevel: () => {}, onTranscript: () => {}, onToolCancel: () => {},
    onToolCall: call => { tools[call.id] = deferred(); return tools[call.id]!.promise; },
    getToken: async () => { log.push('token'); if (!open.token) await gates.token.promise; return { token: 't', model: 'gemini-3.8-live', expiresAt: '', newSessionExpiresAt: '' }; },
  };
  const session = new VoiceSession(handlers, deps);
  return { session, log, gates, connections, tools, states, openAll: () => { open = { token: true, mic: true, connect: true }; } };
}

test('stopping while the token is pending never touches the microphone', async () => {
  const h = harness();
  const starting = h.session.start();
  await tick();
  h.session.stop();
  h.gates.token.resolve();
  await starting;
  assert.deepEqual(h.log, ['token']);
  assert.equal(h.session.active, false);
});

test('stopping during the microphone prompt releases the microphone and never connects', async () => {
  const h = harness();
  h.gates.token.resolve();
  const starting = h.session.start();
  await tick(); await tick();
  h.session.stop();
  h.gates.mic.resolve();
  await starting;
  assert.deepEqual(h.log, ['token', 'mic:start', 'mic:stop']);
});

test('stopping while Live is connecting closes the late connection', async () => {
  const h = harness();
  h.gates.token.resolve(); h.gates.mic.resolve();
  const starting = h.session.start();
  for (let i = 0; i < 5; i++) await tick();
  h.session.stop();
  h.gates.connect.resolve();
  await starting;
  assert.ok(h.log.includes('session:close'));
  assert.equal(h.states.at(-1), 'off');
});

const call = (id: string): LiveServerMessage => ({ toolCall: { functionCalls: [{ id, name: 'build_dashboard', args: { request: 'x' } }] } }) as never;

test('a tool result never reaches a conversation that did not ask for it', async () => {
  const h = harness();
  h.openAll();
  await h.session.start();
  h.connections[0]!.callbacks.onmessage(call('old'));
  h.session.stop();
  await h.session.start();
  h.tools.old!.resolve({ done: true });
  await tick();
  assert.equal(h.connections[0]!.sent.length, 0);
  assert.equal(h.connections[1]!.sent.length, 0, 'the restarted conversation does not receive the old call');
  h.connections[1]!.callbacks.onmessage(call('new'));
  h.tools.new!.resolve({ done: true });
  await tick();
  assert.equal(h.connections[1]!.sent.length, 1);
});

test('results finished during a reconnect are delivered after reconnecting to the same conversation', async () => {
  const h = harness();
  h.openAll();
  await h.session.start();
  h.connections[0]!.callbacks.onmessage(call('slow'));
  h.connections[0]!.callbacks.onclose();
  h.tools.slow!.resolve({ done: true });
  await new Promise(r => setTimeout(r, 450));
  assert.equal(h.connections.length, 2);
  assert.deepEqual((h.connections[1]!.sent[0] as { functionResponses: { id: string }[] }).functionResponses.map(r => r.id), ['slow']);
  h.session.stop();
});
