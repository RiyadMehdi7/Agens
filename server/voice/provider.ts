import type { Dashboard } from '../../shared/dashboard.js';
import type { Dataset } from '../../shared/data.js';
import type { LiveTokenResponse, PlannerOutput } from '../../shared/voice.js';

export interface PlanInput { prompt: string; datasets: Dataset[]; dashboard: Dashboard }

/**
 * Model access used by the HTTP service. The permanent key stays inside the implementation;
 * the browser only ever receives a short-lived, single-use Live token.
 */
export interface VoiceProvider {
  createLiveToken(signal: AbortSignal): Promise<LiveTokenResponse>;
  /** Proposes chart drafts only. The service validates them against real schemas and runs the queries. */
  plan(input: PlanInput, signal: AbortSignal): Promise<PlannerOutput>;
}

/** Thrown by providers so the service can map quota and availability without leaking provider details. */
export class ProviderError extends Error {
  constructor(readonly kind: 'quota' | 'unavailable' | 'invalid-output') { super(kind); }
}
