import { z } from 'zod';
import { chartKinds, chartSchema } from './dashboard.js';
import { idSchema, queryResultSchema } from './data.js';

/** Fixed runtime models for this project. Never substitute older ones silently. */
export const liveModel = 'gemini-3.8-live';
export const plannerModel = 'gemini-3.8-flash';

export const liveTokenResponseSchema = z.object({
  token: z.string().min(1).max(2000), model: z.string().min(1).max(100),
  expiresAt: z.string(), newSessionExpiresAt: z.string(),
}).strict();
export type LiveTokenResponse = z.infer<typeof liveTokenResponseSchema>;

const field = z.string().min(1).max(100);
/** One chart the planner proposes. It is only a suggestion until shared/plan.ts validates it against the real schema. */
export const plannerDraftSchema = z.object({
  datasetId: idSchema, kind: z.enum(chartKinds), title: z.string().min(1).max(200).optional(),
  dimension: field.optional(), dimension2: field.optional(), measure: field.optional(),
  op: z.enum(['sum', 'avg', 'count', 'min', 'max']), x: field.optional(), y: field.optional(),
  columns: z.array(field).max(8).optional(),
}).strict();
export const plannerOutputSchema = z.object({
  charts: z.array(plannerDraftSchema).max(6), summary: z.string().max(600),
}).strict();
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

/** JSON schema handed to Gemini 3.8 Flash as `response_format`. Mirrors plannerOutputSchema. */
export const plannerJsonSchema = {
  type: 'object',
  properties: {
    charts: {
      type: 'array', maxItems: 6,
      items: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' }, kind: { type: 'string', enum: [...chartKinds] }, title: { type: 'string' },
          dimension: { type: 'string' }, dimension2: { type: 'string' }, measure: { type: 'string' },
          op: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max'] }, x: { type: 'string' }, y: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        },
        required: ['datasetId', 'kind', 'op'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['charts', 'summary'],
} as const;

/** What /api/dashboard/plan returns: validated charts with real query evidence. No chart IDs; the canvas assigns them. */
export const planResponseSchema = z.object({
  requestId: idSchema.optional(),
  charts: z.array(z.object({ chart: chartSchema.omit({ id: true }), result: queryResultSchema }).strict()).max(6),
  skipped: z.array(z.string().max(300)).max(6),
  summary: z.string().max(600),
}).strict();
export type PlanResponse = z.infer<typeof planResponseSchema>;

export const liveSystemInstruction = [
  'You are Agens, a voice analytics assistant that builds and edits a dashboard on a shared canvas while you talk.',
  'Be brief and conversational: one or two short sentences per turn.',
  'Every number you say must come from a tool result in this session. Never estimate or invent values.',
  'Use build_dashboard for open requests ("a revenue dashboard by month and region"). It runs in the background: acknowledge it, keep talking, and describe the charts when the result arrives.',
  'Use add_chart for one precise chart, change_chart to switch type or rename, remove_charts, reorder_charts and select_chart for layout.',
  '"This chart", "that one" or "it" means the selected chart: pass "selected". If nothing is selected or a reference could match several charts, ask which one.',
  'To explain a change, call describe_chart and query_data and report measured deltas. Say plainly when the data cannot explain a cause; label any guess as a hypothesis.',
  'Data is read-only. Uploaded files are snapshots; say so if asked about freshness.',
].join(' ');

type Json = Record<string, unknown>;
const str = (description: string, extra: Json = {}) => ({ type: 'string', description, ...extra });
const chartRef = str('Chart to act on: "selected" for the selected chart, a chart id, or its exact title.');

/** Live API tools. All are handled in the browser through the same validated actions as manual controls. */
export const liveTools = [
  { name: 'list_data', description: 'List connected datasets with their columns, plus the charts currently on the canvas and which one is selected.',
    parametersJsonSchema: { type: 'object', properties: {} } },
  { name: 'build_dashboard', description: 'Plan and build one or more charts for an open request. Slow; runs in the background while the conversation continues.',
    parametersJsonSchema: { type: 'object', properties: { request: str('What the user wants to see, in their words.') }, required: ['request'] } },
  { name: 'add_chart', description: 'Add one chart from the active dataset with an exact specification.',
    parametersJsonSchema: { type: 'object', properties: {
      kind: str('Chart type.', { enum: [...chartKinds] }),
      dimension: str('Category column (x axis, slices, heatmap rows or sankey sources).'),
      second_dimension: str('Second category column (heatmap columns or sankey targets).'),
      measure: str('Numeric column to aggregate. Omit when aggregate is count.'),
      aggregate: str('Aggregation.', { enum: ['sum', 'avg', 'count', 'min', 'max'] }),
      x: str('Scatter x column (numeric).'), y: str('Scatter y column (numeric).'),
      columns: { type: 'array', items: { type: 'string' }, description: 'Table columns.' },
    }, required: ['kind'] } },
  { name: 'change_chart', description: 'Change a chart type or title. The chart keeps its data and query.',
    parametersJsonSchema: { type: 'object', properties: { chart: chartRef, kind: str('New chart type.', { enum: [...chartKinds] }), title: str('New title.') }, required: ['chart'] } },
  { name: 'remove_charts', description: 'Remove one or more charts.',
    parametersJsonSchema: { type: 'object', properties: { charts: { type: 'array', items: chartRef } }, required: ['charts'] } },
  { name: 'reorder_charts', description: 'Move the listed charts to the front, in this order. Unlisted charts keep their relative order after them.',
    parametersJsonSchema: { type: 'object', properties: { order: { type: 'array', items: chartRef } }, required: ['order'] } },
  { name: 'select_chart', description: 'Select a chart so "this chart" refers to it, or clear the selection with "none".',
    parametersJsonSchema: { type: 'object', properties: { chart: chartRef }, required: ['chart'] } },
  { name: 'describe_chart', description: 'Get a chart\'s evidence: its query, aggregation, capture time, freshness, truncation and rows (up to 60).',
    parametersJsonSchema: { type: 'object', properties: { chart: chartRef }, required: ['chart'] } },
  { name: 'query_data', description: 'Run a bounded read-only aggregate query on the active dataset to measure changes or breakdowns.',
    parametersJsonSchema: { type: 'object', properties: {
      group_by: { type: 'array', items: { type: 'string' }, description: 'Up to 2 columns to group by.' },
      measure: str('Numeric column. Omit for count.'),
      aggregate: str('Aggregation.', { enum: ['sum', 'avg', 'count', 'min', 'max'] }),
      filter_field: str('Optional column for an equality filter.'), filter_value: str('Value the filter column must equal.'),
    }, required: ['aggregate'] } },
] as const;
export type LiveToolName = (typeof liveTools)[number]['name'];

/**
 * The Live session config, used both to lock the ephemeral token (server) and to connect (browser),
 * so the two always match. Plain strings keep this module free of SDK imports.
 */
export function liveConnectConfig() {
  return {
    responseModalities: ['AUDIO'],
    systemInstruction: liveSystemInstruction,
    tools: [{ functionDeclarations: liveTools.map(tool => ({ ...tool, behavior: 'NON_BLOCKING' })) }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Resumable sessions survive reconnects; compression lifts the 15-minute audio-only limit.
    sessionResumption: {},
    contextWindowCompression: { slidingWindow: {} },
  };
}
