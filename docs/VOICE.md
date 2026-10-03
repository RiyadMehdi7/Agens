# Voice and asynchronous planning — issue #4

Gemini 3.8 Live (`gemini-3.8-live`) is the conversation; Gemini 3.8 Flash (`gemini-3.8-flash`) plans charts.
Both IDs are fixed in `shared/voice.ts` and `server/config.ts`; nothing falls back to an older model.

## Flow

```
mic (16 kHz PCM) ──► Gemini 3.8 Live ──tool call──► browser tool runner ──► canvas actions (shared reducer)
       ▲                    │                              │
 24 kHz audio ◄─────────────┘                              ├─ fast tools: list/add/change/remove/reorder/select/describe/query
                                                           └─ build_dashboard ──► POST /api/dashboard/plan
                                                                                   └─ Flash proposes drafts → server validates
                                                                                      each with shared/plan.ts → runs real queries
```

- **Keys.** The permanent key is read only by the server (`GEMINI_API_KEY`). `POST /api/live/token` returns a
  single-use ephemeral token (new-session window 60 s, expiry 30 min) whose `liveConnectConstraints` lock the
  model and session config. The browser connects to Live directly with it; the SDK chunk loads only on first use.
- **Session config** (`liveConnectConfig()` in `shared/voice.ts`, shared by token and client): audio output,
  input and output transcription, the system instruction, nine tools declared `NON_BLOCKING`, session resumption
  and sliding-window context compression. No `thinkingConfig`: 3.8 Live does not accept it.
- **Asynchronous planning.** `build_dashboard` returns immediately to the model as an in-flight call; the canvas
  shows fogged placeholder tiles while Flash plans and the server queries. The user can keep talking. Results
  are sent back with `scheduling: WHEN_IDLE` so the model mentions them without cutting itself off.
- **Grounding.** Flash only proposes drafts. The server validates each against the owned dataset schema
  (`shared/plan.ts`, the same code the manual controls use), runs the query, and returns only charts backed by
  stored evidence. Every tool result the model sees carries real rows, aggregation, capture time and truncation.
  The system instruction forbids unsupported numbers and asks for hypotheses to be labelled.
- **"This chart."** `selected`/`this`/`it` resolve to the reducer's `selectedChartId`. No selection, or a name that
  matches several charts, returns an error telling the model to ask which chart.

## Robustness

| Situation | Behaviour |
| --- | --- |
| No key on the server | Health reports `voice: unavailable`; the mic explains voice is not configured. |
| Quota exhausted / model down | Token or plan endpoint returns 429 / 503 with a safe message; the mic turns red. Provider details are never forwarded. |
| Microphone denied | Detected before any audio is sent; the mic turns red with instructions. The token is requested first so server problems surface without a permission prompt. |
| User interrupts | `serverContent.interrupted` stops all queued playback immediately. |
| Model cancels a call | `toolCallCancellation` cancels the matching planning request: its placeholders vanish and a late result is discarded. |
| Stale results | Planning results apply only if their request is still live and the canvas was not reset (generation check). Dashboard edits always carry the current `expectedRevision`. |
| Disconnect / `goAway` | Reconnects up to three times with backoff, each with a fresh token and the latest resumption handle. |
| Invalid planner output | Rejected by `plannerOutputSchema`; returned as 503 rather than turned into charts. |

## Health

`availability.voice` and `availability.planner` are `configured` when the server holds a key. That means
configured, not verified: only a real session proves access. `npm run verify:gemini` checks model metadata.

## Local verification — 3 October 2026

- `npm run check`, `npm test` (51 passing, 3 opt-in skipped), `npm run build` pass.
- Server tests with an injected fake provider: health states, token pass-through, quota → 429, outage → 503
  without provider text, planner drafts validated against a real uploaded CSV (valid drafts produce stored
  evidence: months 300/400, regions South 450 / North 250; an unknown column and an unowned dataset are skipped),
  invalid planner output → 503, no data → 400, no provider → 503.
- Client tests: 48 kHz→16 kHz resampling continuity across odd chunk sizes, PCM16 round trip, "this chart"
  resolution and ambiguity, tool actions through canvas controls, cancellation mapped to the planning request.
- Browser, against the real server with a deliberately invalid local key: the mic requested a token, the provider
  rejected it, and the UI showed "The model is unavailable right now." in the error state.
- **Not verified here:** a real spoken session, real planning output, interruption timing and reconnect against the
  live service. This laptop has no Gemini key. Run the demo on Matrix with the team key (issue #6).
