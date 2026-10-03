export type DataSourceKind = 'excel' | 'database' | 'api';
export interface Dataset {
  id: string;
  sourceId: string;
  kind: DataSourceKind;
  name: string;
  columns: { name: string; type: 'string' | 'number' | 'boolean' | 'date' }[];
  rowCount: number;
  capturedAt: string;
  freshness: 'snapshot' | 'live' | 'sample';
}
export interface QueryResult {
  queryId: string;
  datasetId: string;
  rows: Record<string, string | number | boolean | null>[];
  capturedAt: string;
  filters: Record<string, string | number | boolean>;
  aggregation: string;
  truncated: boolean;
}
// Adapters execute bounded, validated requests. Credentials never enter these records.
export interface DataAdapter {
  listDatasets(): Promise<Dataset[]>;
  query(datasetId: string, request: unknown): Promise<QueryResult>;
}

// Additive wire contracts. Existing adapter interfaces above remain source-compatible.
import { z } from 'zod';

export const dataBounds = { columns: 100, filters: 32, inValues: 100, aggregates: 20,
  sort: 20, rows: 1000, stringLength: 4096 } as const;
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const fieldSchema = z.string().min(1).max(100).refine(
  value => !['__proto__', 'prototype', 'constructor'].includes(value), 'Reserved field name');
export const timestampSchema = z.iso.datetime({ precision: 3 });
export const cellSchema = z.union([z.string().max(dataBounds.stringLength), z.number().finite(), z.boolean(), z.null()]);
const scalarSchema = z.union([z.string().max(dataBounds.stringLength), z.number().finite(), z.boolean()]);
const uniqueFields = z.array(fieldSchema).min(1).max(dataBounds.columns)
  .refine(fields => new Set(fields).size === fields.length, 'Duplicate fields');
const valueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('string'), value: z.string().max(dataBounds.stringLength) }).strict(),
  z.object({ type: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('date'), value: timestampSchema }).strict(),
  z.object({ type: z.literal('null'), value: z.null() }).strict(),
]);
export const filterSchema = z.discriminatedUnion('op', [
  z.object({ field: fieldSchema, op: z.enum(['eq', 'ne']), value: valueSchema }).strict(),
  z.object({ field: fieldSchema, op: z.enum(['gt', 'gte', 'lt', 'lte']), value: valueSchema }).strict()
    .refine(filter => ['number', 'date', 'string'].includes(filter.value.type), 'Ordered comparison needs number, date or string'),
  z.object({ field: fieldSchema, op: z.literal('in'), values: z.array(valueSchema).min(1).max(dataBounds.inValues) }).strict()
    .refine(filter => new Set(filter.values.filter(value => value.type !== 'null').map(value => value.type)).size <= 1,
      'IN values must have one non-null type'),
]);
export const aggregateSchema = z.object({
  op: z.enum(['count', 'sum', 'avg', 'min', 'max']), field: fieldSchema.optional(),
  alias: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).pipe(fieldSchema),
}).strict().refine(value => value.op === 'count' || value.field !== undefined, 'Aggregate requires a field');
export const queryRequestSchema = z.object({
  datasetId: idSchema, requestId: idSchema.optional(),
  projection: uniqueFields.optional(), filters: z.array(filterSchema).max(dataBounds.filters).default([]),
  groupBy: uniqueFields.optional(), aggregates: z.array(aggregateSchema).min(1).max(dataBounds.aggregates).optional(),
  sort: z.array(z.object({ field: fieldSchema, direction: z.enum(['asc', 'desc']) }).strict()).max(dataBounds.sort).default([]),
  limit: z.number().int().min(1).max(dataBounds.rows).default(100),
}).strict().superRefine((request, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (request.groupBy && !request.aggregates) fail('groupBy requires aggregates');
  if (request.projection && request.aggregates) fail('projection cannot be combined with aggregates');
  const aliases = request.aggregates?.map(value => value.alias) ?? [];
  if (new Set(aliases).size !== aliases.length) fail('Duplicate aggregate aliases');
  if (aliases.some(alias => request.groupBy?.includes(alias))) fail('Aggregate alias collides with groupBy');
  if (new Set(request.sort.map(value => value.field)).size !== request.sort.length) fail('Duplicate sort fields');
  const output = request.aggregates ? [...(request.groupBy ?? []), ...aliases] : request.projection;
  if (output && request.sort.some(value => !output.includes(value.field))) fail('Sort field must be in output');
});
export type QueryRequest = z.infer<typeof queryRequestSchema>;
export const datasetSchema = z.object({
  id: idSchema, sourceId: idSchema, kind: z.enum(['excel', 'database', 'api']), name: z.string().min(1).max(200),
  columns: z.array(z.object({ name: fieldSchema, type: z.enum(['string', 'number', 'boolean', 'date']) }).strict())
    .min(1).max(dataBounds.columns).refine(columns => new Set(columns.map(column => column.name)).size === columns.length, 'Duplicate columns'),
  rowCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), capturedAt: timestampSchema,
  freshness: z.enum(['snapshot', 'live', 'sample']),
}).strict();
export const queryResultSchema = z.object({
  queryId: idSchema, datasetId: idSchema,
  rows: z.array(z.record(fieldSchema, cellSchema).refine(row => Object.keys(row).length <= dataBounds.columns + dataBounds.aggregates)).max(dataBounds.rows),
  capturedAt: timestampSchema,
  filters: z.record(fieldSchema, scalarSchema).refine(filters => Object.keys(filters).length <= dataBounds.filters),
  aggregation: z.string().max(2000), truncated: z.boolean(), normalizedRequest: queryRequestSchema.optional(),
}).strict();

// Optional rich provenance leaves QueryResult.filters usable by existing consumers.
export interface QueryResult { normalizedRequest?: QueryRequest }

/** Validate source fields and literal types before an adapter sees a request. */
export function validateQueryForDataset(input: unknown, dataset: Dataset): QueryRequest {
  const request = queryRequestSchema.parse(input);
  const columns = new Map(dataset.columns.map(column => [column.name, column.type]));
  const requireField = (field: string) => {
    const type = columns.get(field);
    if (!type) throw new Error('Unknown query field');
    return type;
  };
  for (const field of [...(request.projection ?? []), ...(request.groupBy ?? [])]) requireField(field);
  for (const filter of request.filters) {
    const type = requireField(filter.field);
    for (const value of filter.op === 'in' ? filter.values : [filter.value]) {
      if (value.type !== 'null' && value.type !== type) throw new Error('Filter type does not match column');
    }
  }
  for (const aggregate of request.aggregates ?? []) {
    const type = aggregate.field ? requireField(aggregate.field) : undefined;
    if (['sum', 'avg'].includes(aggregate.op) && type !== 'number') throw new Error('Numeric aggregate requires number');
    if (['min', 'max'].includes(aggregate.op) && !['number', 'date', 'string'].includes(type ?? '')) throw new Error('Invalid ordered aggregate');
  }
  if (!request.aggregates) for (const sort of request.sort) requireField(sort.field);
  if (request.datasetId !== dataset.id) throw new Error('Dataset mismatch');
  return request;
}
