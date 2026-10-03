import { z } from 'zod';
import { datasetListResponseSchema, errorResponseSchema, importInspectionResponseSchema, importResponseSchema, queryResponseSchema,
  type ConnectSourceRequest, type ImportRequest, type planRequestSchema } from '../../shared/api.js';
import type { Dataset, QueryResult } from '../../shared/data.js';
import { liveTokenResponseSchema, planResponseSchema, type LiveTokenResponse, type PlanResponse } from '../../shared/voice.js';
import { ApiFailure } from './errors.js';
import type { AgensApi, QueryInput } from './types.js';

type Listener = () => void;
const resetListeners = new Set<Listener>();
/** Called when the server replaced an expired session: earlier dataset and query IDs are gone. */
export function onSessionReset(listener: Listener): () => void {
  resetListeners.add(listener);
  return () => { resetListeners.delete(listener); };
}

const modelPaths = new Set(['/api/live/token', '/api/dashboard/plan']);

async function call<T>(path: string, schema: z.ZodType<T>, body?: unknown, retried = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure('NETWORK');
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ApiFailure('INVALID_RESPONSE', undefined, response.status); }
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(payload);
    const code = parsed.success ? parsed.data.error.code : 'INTERNAL_ERROR';
    // The server clears a stale cookie with the 401; one fresh retry starts a new session.
    if (code === 'UNAUTHORIZED' && !retried) {
      resetListeners.forEach(listener => listener());
      return call(path, schema, body, true);
    }
    // Model endpoints return purpose-written, user-safe messages (quota, model unavailable); keep them.
    const own = parsed.success && modelPaths.has(path) ? parsed.data.error.message : undefined;
    throw new ApiFailure(code, own, response.status);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiFailure('INVALID_RESPONSE', undefined, response.status);
  return parsed.data;
}

type PlanRequest = z.input<typeof planRequestSchema>;

export class HttpApi implements AgensApi {
  readonly mode = 'server' as const;
  async listDatasets(): Promise<Dataset[]> {
    return (await call('/api/datasets', datasetListResponseSchema)).datasets;
  }
  async importDataset(request: ImportRequest): Promise<Dataset> {
    return (await call('/api/datasets/import', importResponseSchema, request)).dataset;
  }
  async query(request: QueryInput): Promise<QueryResult> {
    return (await call('/api/query', queryResponseSchema, request)).result;
  }
  /** Sheet names of a workbook without registering it. CSV has none. */
  async inspect(request: ImportRequest): Promise<string[]> {
    return (await call('/api/datasets/inspect', importInspectionResponseSchema, request)).sheets;
  }
  /** Attach an operator-configured Postgres or HTTPS source with its access capability. */
  async connect(request: ConnectSourceRequest): Promise<Dataset> {
    return (await call('/api/sources/connect', importResponseSchema, request)).dataset;
  }
  async refresh(datasetId: string): Promise<Dataset> {
    return (await call(`/api/datasets/${encodeURIComponent(datasetId)}/refresh`, importResponseSchema, {})).dataset;
  }
  /** Slow chart planning with Gemini 3.8 Flash; returns only charts backed by real query evidence. */
  async plan(request: PlanRequest): Promise<PlanResponse> {
    return call('/api/dashboard/plan', planResponseSchema, request);
  }
  /** A short-lived single-use Live token. The permanent key stays on the server. */
  async liveToken(): Promise<LiveTokenResponse> {
    return call('/api/live/token', liveTokenResponseSchema, {});
  }
  async status(datasetId: string): Promise<SourceStatus> {
    return call(`/api/datasets/${encodeURIComponent(datasetId)}/status`, sourceStatusSchema);
  }
}

// Mirrors docs/DATA_RUNTIME.md; the server does not export a schema for this response.
const sourceStatusSchema = z.object({
  datasetId: z.string(), state: z.enum(['verified', 'snapshot', 'failed']), lastVerifiedAt: z.string(), lastError: z.string().optional(),
}).strict();
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
