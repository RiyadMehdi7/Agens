import { randomBytes } from 'node:crypto';
import { datasetSchema, queryRequestSchema, queryResultSchema, validateQueryForDataset,
  type DataAdapter, type Dataset, type QueryRequest, type QueryResult } from '../../shared/data.js';
import { importRequestSchema, planRequestSchema, type ErrorCode, type ImportRequest } from '../../shared/api.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string) { super(message); }
}
const unavailable = () => new ApiError(503, 'NOT_IMPLEMENTED', 'This capability is not implemented.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'Resource not found.');
const limited = () => new ApiError(429, 'RESOURCE_LIMIT', 'Session resource limit reached.');
const identifier = () => randomBytes(24).toString('base64url');
function frozenCopy<T>(value: T): T {
  const copy: T = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(copy);
  return copy;
}

/** A fresh, isolated adapter per issued session. Never return a shared mutable adapter. */
export interface SessionDataAdapter extends DataAdapter {
  importDataset?(request: ImportRequest, context: { signal: AbortSignal }): Promise<Dataset>;
  query(datasetId: string, request: QueryRequest, context?: { signal: AbortSignal }): Promise<QueryResult>;
  dispose?(): void;
}
export interface ServiceOptions {
  createAdapter?: (context: { sessionId: string; signal: AbortSignal }) => SessionDataAdapter;
  now?: () => number;
  limits?: Partial<typeof defaultLimits>;
}
export const defaultLimits = { sessionTtlMs: 30 * 60 * 1000, maxSessions: 32, maxDatasets: 20,
  maxQueries: 50, maxEvidenceBytes: 2 * 1024 * 1024, operationTimeoutMs: 5000 };
interface OwnedDataset { public: Dataset; internalId: string }
interface Session {
  id: string; expiresAt: number; controller: AbortController; adapter?: SessionDataAdapter;
  datasets: Map<string, OwnedDataset>; queries: Map<string, QueryResult>; bytes: number; busy: boolean;
}

export class ApiService {
  readonly limits: typeof defaultLimits;
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  constructor(private readonly options: ServiceOptions = {}) {
    this.limits = { ...defaultLimits, ...options.limits };
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > defaultLimits[key as keyof typeof defaultLimits]) {
        throw new Error('Limits must be positive integers no larger than defaults');
      }
    }
    this.now = options.now ?? Date.now;
  }
  health() {
    return { status: 'ok', stage: 'integration-skeleton', availability: {
      data: this.options.createAdapter ? 'adapter-injected' : 'unavailable', voice: 'unavailable', planner: 'unavailable',
    }, voiceImplemented: false, dataConnectorsImplemented: false } as const;
  }
  prune() {
    for (const session of this.sessions.values()) if (session.expiresAt <= this.now()) this.remove(session);
  }
  private remove(session: Session) {
    this.sessions.delete(session.id);
    session.controller.abort();
    session.datasets.clear(); session.queries.clear();
    try { session.adapter?.dispose?.(); } catch { /* Cleanup errors never escape the boundary. */ }
  }
  close() { for (const session of this.sessions.values()) this.remove(session); }
  session(cookieId?: string): { id: string; issued: boolean } {
    this.prune();
    if (cookieId !== undefined) {
      if (!this.sessions.has(cookieId)) throw new ApiError(401, 'UNAUTHORIZED', 'Session is invalid or expired.');
      return { id: cookieId, issued: false };
    }
    if (this.sessions.size >= this.limits.maxSessions) throw limited();
    const id = identifier();
    const session: Session = { id, expiresAt: this.now() + this.limits.sessionTtlMs, controller: new AbortController(),
      datasets: new Map(), queries: new Map(), bytes: 0, busy: false };
    this.sessions.set(id, session);
    return { id, issued: true };
  }
  private get(id: string) {
    this.prune();
    const session = this.sessions.get(id);
    if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Session is invalid or expired.');
    return session;
  }
  private adapter(session: Session) {
    if (!this.options.createAdapter) throw unavailable();
    session.adapter ??= this.options.createAdapter({ sessionId: session.id, signal: session.controller.signal });
    return session.adapter;
  }
  private async operation<T>(session: Session, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (session.busy) throw limited();
    session.busy = true;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    session.controller.signal.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve().then(() => run(controller.signal));
    // A timed-out adapter that ignores abort retains its busy slot until it settles.
    void work.finally(() => { session.busy = false; }).catch(() => {});
    try {
      const result = await Promise.race([work, new Promise<never>((_, reject) => {
        const fail = () => reject(new ApiError(503, 'UNAVAILABLE', 'Data operation unavailable.'));
        controller.signal.addEventListener('abort', fail, { once: true });
        if (controller.signal.aborted) fail();
        timer = setTimeout(() => controller.abort(), this.limits.operationTimeoutMs);
      })]);
      this.get(session.id); // Never publish results into an expired session.
      return result;
    } finally {
      clearTimeout(timer);
      session.controller.signal.removeEventListener('abort', onAbort);
    }
  }
  list(id: string) {
    const session = this.get(id);
    if (!this.options.createAdapter) throw unavailable();
    return { datasets: [...session.datasets.values()].map(value => structuredClone(value.public)) };
  }
  async import(id: string, input: unknown) {
    const request = importRequestSchema.parse(input);
    if (Buffer.from(request.contentBase64, 'base64').length > 256 * 1024) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Import exceeds byte limit.');
    }
    const session = this.get(id);
    if (session.datasets.size >= this.limits.maxDatasets) throw limited();
    const adapter = this.adapter(session);
    if (!adapter.importDataset) throw unavailable();
    const raw = await this.operation(session, signal => adapter.importDataset!(request, { signal }));
    const parsed = datasetSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError(503, 'UNAVAILABLE', 'Adapter returned invalid data.');
    if ([...session.datasets.values()].some(value => value.internalId === parsed.data.id)) {
      throw new ApiError(409, 'CONFLICT', 'Adapter dataset identifier was reused.');
    }
    const dataset = frozenCopy({ ...parsed.data, id: identifier(), sourceId: identifier() });
    const bytes = Buffer.byteLength(JSON.stringify(dataset));
    if (session.bytes + bytes > this.limits.maxEvidenceBytes) throw limited();
    session.datasets.set(dataset.id, { public: dataset, internalId: parsed.data.id });
    session.bytes += bytes;
    return { dataset: structuredClone(dataset) };
  }
  async query(id: string, input: unknown) {
    const parsed = queryRequestSchema.parse(input);
    const session = this.get(id);
    if (!this.options.createAdapter) throw unavailable();
    const owned = session.datasets.get(parsed.datasetId);
    if (!owned) throw missing();
    let request: QueryRequest;
    try { request = validateQueryForDataset(parsed, owned.public); }
    catch { throw new ApiError(400, 'INVALID_REQUEST', 'Query does not match dataset schema.'); }
    if (session.queries.size >= this.limits.maxQueries) throw limited();
    const adapter = this.adapter(session);
    const raw = await this.operation(session, signal => adapter.query(owned.internalId,
      { ...structuredClone(request), datasetId: owned.internalId }, { signal }));
    const output = queryResultSchema.safeParse(raw);
    if (!output.success || output.data.datasetId !== owned.internalId || output.data.rows.length > request.limit) {
      throw new ApiError(503, 'UNAVAILABLE', 'Adapter returned invalid evidence.');
    }
    const fields = request.aggregates ? [...(request.groupBy ?? []), ...request.aggregates.map(value => value.alias)]
      : request.projection ?? owned.public.columns.map(value => value.name);
    const types = new Map(owned.public.columns.map(value => [value.name, value.type]));
    for (const aggregate of request.aggregates ?? []) types.set(aggregate.alias,
      ['count', 'sum', 'avg'].includes(aggregate.op) ? 'number' : types.get(aggregate.field!)!);
    for (const row of output.data.rows) {
      if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))) {
        throw new ApiError(503, 'UNAVAILABLE', 'Adapter returned invalid evidence.');
      }
      for (const field of fields) {
        const value = row[field];
        const type = types.get(field);
        const valid = value === null || (type === 'date' ? typeof value === 'string' &&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
          Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value : typeof value === type);
        if (!valid) throw new ApiError(503, 'UNAVAILABLE', 'Adapter returned invalid evidence.');
      }
    }
    const evidence = frozenCopy({ ...output.data, queryId: identifier(), datasetId: owned.public.id, normalizedRequest: request });
    const bytes = Buffer.byteLength(JSON.stringify(evidence));
    if (session.bytes + bytes > this.limits.maxEvidenceBytes) throw limited();
    session.bytes += bytes;
    session.queries.set(evidence.queryId, evidence);
    return { result: structuredClone(evidence) };
  }
  evidence(id: string, queryId: string, datasetId?: string) {
    const session = this.get(id);
    const result = session.queries.get(queryId);
    if (!result) throw missing();
    if (datasetId !== undefined && result.datasetId !== datasetId) {
      throw new ApiError(409, 'CONFLICT', 'Dataset and query references do not match.');
    }
    return { result: structuredClone(result) };
  }
  plan(id: string, input: unknown): never {
    const request = planRequestSchema.parse(input);
    this.get(id);
    for (const reference of [...request.evidence, ...request.dashboard.charts]) {
      this.evidence(id, reference.queryId, reference.datasetId);
    }
    throw unavailable();
  }
  live(id: string): never { this.get(id); throw unavailable(); }
}
