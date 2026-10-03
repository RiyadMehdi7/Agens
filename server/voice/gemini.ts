import { GoogleGenAI, type LiveConnectConfig } from '@google/genai';
import { liveConnectConfig, liveModel, plannerJsonSchema, plannerModel, plannerOutputSchema, type LiveTokenResponse,
  type PlannerOutput } from '../../shared/voice.js';
import { ProviderError, type PlanInput, type VoiceProvider } from './provider.js';

const plannerInstruction = [
  'You plan charts for an analytics canvas. Output JSON only, matching the schema.',
  'Use only the datasets and exact column names given. Never invent columns or values.',
  'Pick the clearest chart type: line or area for values over a date column; bar for comparing categories;',
  'pie (donut) or treemap for shares of a whole with few categories; heatmap for two categories against a number;',
  'sankey for flows between two categories; scatter for two numeric columns; metric for a single total; table for raw rows.',
  'Prefer 1 to 4 charts unless the request asks for more. Do not repeat a chart that is already on the canvas.',
  'Give each chart a short human title. The summary is one sentence saying what you planned, with no numbers.',
].join(' ');

function describe(input: PlanInput): string {
  const datasets = input.datasets.map(d => ({ datasetId: d.id, name: d.name, rows: d.rowCount, freshness: d.freshness,
    columns: d.columns.map(c => `${c.name}:${c.type}`) }));
  const charts = input.dashboard.charts.map(c => ({ title: c.title, kind: c.kind }));
  return JSON.stringify({ request: input.prompt, datasets, chartsOnCanvas: charts });
}

function classify(error: unknown): ProviderError {
  const status = (error as { status?: number })?.status;
  return new ProviderError(status === 429 ? 'quota' : 'unavailable');
}

export function createGeminiVoice(apiKey: string): VoiceProvider {
  const client = new GoogleGenAI({ apiKey });
  return {
    async createLiveToken(signal): Promise<LiveTokenResponse> {
      const now = Date.now();
      const expiresAt = new Date(now + 30 * 60 * 1000).toISOString();
      const newSessionExpiresAt = new Date(now + 60 * 1000).toISOString();
      try {
        const token = await client.authTokens.create({ config: {
          uses: 1, expireTime: expiresAt, newSessionExpireTime: newSessionExpiresAt, abortSignal: signal,
          // Shared config uses the enums' string values ('AUDIO', 'NON_BLOCKING') so the browser can import it without the SDK.
          liveConnectConstraints: { model: liveModel, config: liveConnectConfig() as unknown as LiveConnectConfig },
        } });
        if (!token.name) throw new ProviderError('invalid-output');
        return { token: token.name, model: liveModel, expiresAt, newSessionExpiresAt };
      } catch (error) {
        throw error instanceof ProviderError ? error : classify(error);
      }
    },
    async plan(input, signal): Promise<PlannerOutput> {
      let text: string | null | undefined;
      try {
        const interaction = await client.interactions.create({
          model: plannerModel, input: describe(input), system_instruction: plannerInstruction, store: false,
          response_format: { type: 'text', mime_type: 'application/json', schema: structuredClone(plannerJsonSchema) as Record<string, unknown> },
        }, { fetchOptions: { signal } });
        text = interaction.output_text;
      } catch (error) {
        throw classify(error);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(text ?? ''); } catch { throw new ProviderError('invalid-output'); }
      const output = plannerOutputSchema.safeParse(parsed);
      if (!output.success) throw new ProviderError('invalid-output');
      return output.data;
    },
  };
}
