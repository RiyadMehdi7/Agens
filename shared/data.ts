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
