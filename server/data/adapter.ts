import { createHash, randomUUID } from 'node:crypto';
import { importRequestSchema, type ImportRequest } from '../../shared/api.js';
import { datasetSchema, type Dataset, type QueryResult } from '../../shared/data.js';
import { ApiError, type SessionDataAdapter } from '../http/service.js';
import { csvRows, workbookRows, table, importBounds } from './import.js';
import { evaluate, type Row } from './query.js';
export interface StoredTable { dataset: Dataset; rows: Row[]; raw?: unknown[][] }
/** One instance per owner/session. Raw data lives only in bounded private memory, outside Git. */
export class WorkbookAdapter implements SessionDataAdapter {
  private tables = new Map<string, StoredTable>();
  private evidence = new Map<string, QueryResult>();
  private bytes=0;
  constructor(private options: { locale?: 'en-US'|'de-DE'; now?: ()=>Date; signal?: AbortSignal }={}) {}
  private check(signal?: AbortSignal) { this.options.signal?.throwIfAborted(); signal?.throwIfAborted(); }
  async inspectWorkbook(content: Buffer, signal?: AbortSignal) {
    this.check(signal); if(content.length>importBounds.bytes) throw new ApiError(413,'PAYLOAD_TOO_LARGE','Import exceeds byte limit.');
    const result=await workbookRows(content); this.check(signal); return result.sheets;
  }
  async importDataset(input: ImportRequest, context: {signal:AbortSignal}): Promise<Dataset> {
    const request=importRequestSchema.parse(input); this.check(context.signal);
    const buffer=Buffer.from(request.contentBase64,'base64');
    if(buffer.length>importBounds.bytes) throw new ApiError(413,'PAYLOAD_TOO_LARGE','Import exceeds byte limit.');
    let parsed: ReturnType<typeof table>;
    try { parsed=table(request.format==='csv' ? csvRows(buffer) : (await workbookRows(buffer,request.sheet)).rows,this.options.locale); }
    catch { throw new ApiError(400,'INVALID_REQUEST','Invalid or unsupported table, sheet, or import bounds.'); }
    this.check(context.signal);
    const capturedAt=(this.options.now?.() ?? new Date()).toISOString();
    const id=createHash('sha256').update(buffer).update(request.sheet ?? '').update(this.options.locale ?? 'en-US').update(randomUUID()).digest('hex');
    const dataset=datasetSchema.parse({id,sourceId:randomUUID(),kind:'excel',name:request.name,columns:parsed.columns,
      rowCount:parsed.rows.length,capturedAt,freshness:'snapshot'});
    this.add({dataset,rows:parsed.rows,raw:parsed.raw}); return structuredClone(dataset);
  }
  add(stored: StoredTable) {
    const dataset=datasetSchema.parse(stored.dataset);
    if(stored.rows.length!==dataset.rowCount || stored.rows.length>importBounds.rows || this.tables.has(dataset.id)) throw new Error('Invalid table');
    const bytes=Buffer.byteLength(JSON.stringify(stored));
    if(this.tables.size>=20 || this.bytes+bytes>8*1024*1024) throw new ApiError(429,'RESOURCE_LIMIT','Dataset storage limit reached.');
    this.bytes+=bytes; this.tables.set(dataset.id,structuredClone(stored));
  }
  async listDatasets() { this.check(); return [...this.tables.values()].map(t=>structuredClone(t.dataset)); }
  async query(datasetId: string,input: unknown,context?: {signal:AbortSignal}) {
    this.check(context?.signal); const stored=this.tables.get(datasetId);
    if(!stored) throw new ApiError(404,'NOT_FOUND','Resource not found.');
    const result=evaluate(stored.dataset,stored.rows,input);
    const bytes=Buffer.byteLength(JSON.stringify(result));
    if(!this.evidence.has(result.queryId)) {
      if(this.evidence.size>=50 || this.bytes+bytes>10*1024*1024) throw new ApiError(429,'RESOURCE_LIMIT','Evidence limit reached.');
      this.bytes+=bytes; this.evidence.set(result.queryId,structuredClone(result));
    }
    this.check(context?.signal); return structuredClone(this.evidence.get(result.queryId)!);
  }
  getEvidence(queryId:string) { const value=this.evidence.get(queryId); if(!value) throw new ApiError(404,'NOT_FOUND','Resource not found.'); return structuredClone(value); }
  dispose() { this.tables.clear(); this.evidence.clear(); this.bytes=0; }
}
export const createWorkbookAdapter = (context: {sessionId:string;signal:AbortSignal}) => new WorkbookAdapter({signal:context.signal});
