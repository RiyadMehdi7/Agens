import type { z } from 'zod';
import type { ImportRequest } from '../../shared/api.js';
import type { Dataset, QueryResult, queryRequestSchema } from '../../shared/data.js';

export type QueryInput = z.input<typeof queryRequestSchema>;

/** Everything the canvas needs from a data backend. Voice tools reuse the same calls. */
export interface AgensApi {
  /** `sample` is an in-browser fixture: every dataset it returns is labelled sample. */
  readonly mode: 'server' | 'sample';
  listDatasets(): Promise<Dataset[]>;
  importDataset(request: ImportRequest): Promise<Dataset>;
  query(request: QueryInput): Promise<QueryResult>;
}
