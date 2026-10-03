import { z } from 'zod';
import { datasetSchema, idSchema, queryRequestSchema, queryResultSchema } from './data.js';
import { dashboardSchema } from './dashboard.js';

export const importRequestSchema = z.object({
  format: z.enum(['csv', 'xlsx']), name: z.string().min(1).max(200),
  contentBase64: z.string().min(4).max(350000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  sheet: z.string().min(1).max(100).optional(), requestId: idSchema.optional(),
}).strict().refine(value => value.format === 'xlsx' || value.sheet === undefined, 'CSV has no sheets');
export type ImportRequest = z.infer<typeof importRequestSchema>;
export const connectSourceRequestSchema=z.object({sourceId:idSchema,accessToken:z.string().min(32).max(512)}).strict();
export type ConnectSourceRequest=z.infer<typeof connectSourceRequestSchema>;
export const importInspectionResponseSchema=z.object({sheets:z.array(z.string().min(1).max(100)).max(20)}).strict();
export const evidenceReferenceSchema = z.object({ datasetId: idSchema, queryId: idSchema }).strict();
export const planRequestSchema = z.object({
  requestId: idSchema.optional(), prompt: z.string().min(1).max(4000),
  dashboard: dashboardSchema, evidence: z.array(evidenceReferenceSchema).max(50),
}).strict();
export const liveTokenRequestSchema = z.object({ requestId: idSchema.optional() }).strict();
export const toolRequestSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('list_datasets'), arguments: z.object({}).strict() }).strict(),
  z.object({ name: z.literal('query_data'), arguments: queryRequestSchema }).strict(),
  z.object({ name: z.literal('get_query'), arguments: evidenceReferenceSchema }).strict(),
  z.object({ name: z.literal('plan_dashboard'), arguments: planRequestSchema }).strict(),
]);
export const errorCodeSchema = z.enum(['INVALID_REQUEST', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE',
  'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RESOURCE_LIMIT', 'NOT_IMPLEMENTED', 'UNAVAILABLE', 'INTERNAL_ERROR']);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const errorResponseSchema = z.object({ error: z.object({ code: errorCodeSchema, message: z.string() }).strict() }).strict();
export const datasetListResponseSchema = z.object({ datasets: z.array(datasetSchema).max(20) }).strict();
export const importResponseSchema = z.object({ dataset: datasetSchema }).strict();
export const queryResponseSchema = z.object({ result: queryResultSchema }).strict();
export const healthResponseSchema = z.object({
  status: z.literal('ok'), stage: z.literal('integration-skeleton'),
  availability: z.object({ data: z.enum(['unavailable', 'adapter-injected', 'ready']), voice: z.literal('unavailable'), planner: z.literal('unavailable') }).strict(),
  voiceImplemented: z.literal(false), dataConnectorsImplemented: z.boolean(),
}).strict();
