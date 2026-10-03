import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { datasetSchema, idSchema, type Dataset, type QueryRequest } from '../../shared/data.js';
import { type ImportRequest, type ConnectSourceRequest } from '../../shared/api.js';
import { ApiError, type SessionDataAdapter } from '../http/service.js';
import { WorkbookAdapter } from './adapter.js';
import { HttpsJsonAdapter, allowedUrl } from './https.js';
import { PostgresAdapter } from './postgres.js';

const common={id:idSchema,tokenHash:z.string().regex(/^[a-f0-9]{64}$/)};
const sourceSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('postgres'),connection:z.object({
    connectionString:z.string().min(1).max(4096),ssl:z.boolean().optional(),
  }).strict(),source:z.object({schema:z.string().min(1).max(63),table:z.string().min(1).max(63),
    columns:datasetSchema.shape.columns,orderBy:z.array(z.string().min(1).max(63)).min(1).max(100),
  }).strict()}).strict(),
  z.object({...common,kind:z.literal('https'),source:z.object({
    endpoint:z.url().max(4096),allowedOrigins:z.array(z.url().max(4096)).min(1).max(10),
    name:z.string().min(1).max(200),headers:z.record(z.string().max(100),z.string().max(4096)).optional(),
  }).strict()}).strict(),
]);
const configSchema=z.object({sources:z.array(sourceSchema).max(50)}).strict().refine(
  c=>new Set(c.sources.map(s=>s.id)).size===c.sources.length,'Duplicate source IDs');
type Config=z.infer<typeof configSchema>;
type Connector=PostgresAdapter|HttpsJsonAdapter;

/** Private operator configuration, with a capability per source and single-session claims. */
export class SourceRegistry {
  #config:Config;
  #owners=new Map<string,string>();
  constructor(config:unknown={sources:[]}) {
    try {
      this.#config=configSchema.parse(config);
      for(const entry of this.#config.sources) if(entry.kind==='https') allowedUrl(entry.source.endpoint,entry.source.allowedOrigins);
    } catch {throw new Error('Invalid private source configuration');}
  }
  claim(request:ConnectSourceRequest,sessionId:string):Connector {
    const entry=this.#config.sources.find(s=>s.id===request.sourceId);
    const actual=createHash('sha256').update(request.accessToken).digest();
    const expected=Buffer.from(entry?.tokenHash ?? '0'.repeat(64),'hex');
    if(!entry || !timingSafeEqual(actual,expected) || this.#owners.has(entry.id)) {
      throw new ApiError(404,'NOT_FOUND','Configured source is unavailable.');
    }
    const connector=entry.kind==='postgres'?new PostgresAdapter(entry.connection,entry.source):new HttpsJsonAdapter(entry.source);
    this.#owners.set(entry.id,sessionId); return connector;
  }
  release(sourceId:string,sessionId:string) {if(this.#owners.get(sourceId)===sessionId) this.#owners.delete(sourceId);}
}
export async function loadSourceRegistry(path?:string) {
  if(!path) return new SourceRegistry();
  try {
    if(!isAbsolute(path)) throw new Error();
    const info=await stat(path);
    if(!info.isFile() || info.size>256*1024 || process.platform!=='win32' && (info.mode&0o077)!==0) throw new Error();
    return new SourceRegistry(JSON.parse(await readFile(path,'utf8')));
  } catch {throw new Error('Private source configuration could not be loaded. Use an absolute, owner-only file.');}
}

export class RuntimeDataAdapter implements SessionDataAdapter {
  #workbook:WorkbookAdapter;
  #connections=new Map<string,{connector:Connector;sourceId:string}>();
  #closed=false;
  constructor(private context:{sessionId:string;signal:AbortSignal},private registry:SourceRegistry,locale:'en-US'|'de-DE'='en-US') {
    this.#workbook=new WorkbookAdapter({signal:context.signal,locale});
  }
  private check(signal?:AbortSignal) {if(this.#closed) throw new Error('Adapter closed'); this.context.signal.throwIfAborted();signal?.throwIfAborted();}
  importDataset(request:ImportRequest,context:{signal:AbortSignal}) {this.check(context.signal);return this.#workbook.importDataset(request,context);}
  async inspectImport(request:ImportRequest,context:{signal:AbortSignal}) {
    this.check(context.signal);
    return {sheets:request.format==='xlsx'?await this.#workbook.inspectWorkbook(Buffer.from(request.contentBase64,'base64'),context.signal):[]};
  }
  async connectSource(request:ConnectSourceRequest,context:{signal:AbortSignal}) {
    this.check(context.signal);
    if(this.#connections.size>=10) throw new ApiError(429,'RESOURCE_LIMIT','Connector limit reached.');
    const connector=this.registry.claim(request,this.context.sessionId);
    try {
      let dataset:Dataset;
      if(connector instanceof HttpsJsonAdapter) dataset=(await connector.refresh(context.signal)).dataset;
      else {
        const initial=(await connector.listDatasets())[0]!;
        await connector.query(initial.id,{datasetId:initial.id,aggregates:[{op:'count',alias:'count'}]},context);
        dataset=(await connector.listDatasets())[0]!;
      }
      this.check(context.signal);
      this.#connections.set(dataset.id,{connector,sourceId:request.sourceId});return dataset;
    } catch {
      this.registry.release(request.sourceId,this.context.sessionId);
      if(connector instanceof PostgresAdapter) await connector.dispose().catch(()=>{});
      throw new ApiError(503,'UNAVAILABLE','Source verification failed. Check private server configuration.');
    }
  }
  async refreshDataset(id:string,context:{signal:AbortSignal}) {
    this.check(context.signal);const connection=this.#connections.get(id);
    if(!connection) throw new ApiError(400,'INVALID_REQUEST','Uploaded workbooks are snapshots; upload a new file.');
    try {
      if(connection.connector instanceof HttpsJsonAdapter) await connection.connector.refresh(context.signal);
      else await connection.connector.query(id,{datasetId:id,aggregates:[{op:'count',alias:'count'}]},context);
      this.check(context.signal);return (await connection.connector.listDatasets())[0]!;
    } catch {throw new ApiError(503,'UNAVAILABLE','Source refresh failed; previous capture remains unchanged.');}
  }
  async listDatasets() {
    this.check();const rows=await this.#workbook.listDatasets();
    for(const {connector} of this.#connections.values()) rows.push(...await connector.listDatasets());return rows;
  }
  async query(id:string,request:QueryRequest,context?:{signal:AbortSignal}) {
    this.check(context?.signal);const connection=this.#connections.get(id);
    if(!connection) return this.#workbook.query(id,request,context);
    try {const result=await connection.connector.query(id,request,context);this.check(context?.signal);return result;}
    catch {throw new ApiError(503,'UNAVAILABLE','Source query failed; no new evidence was recorded.');}
  }
  dispose() {
    this.#closed=true;this.#workbook.dispose();
    for(const {connector,sourceId} of this.#connections.values()) {
      this.registry.release(sourceId,this.context.sessionId);
      if(connector instanceof PostgresAdapter) void connector.dispose().catch(()=>{});
    }
    this.#connections.clear();
  }
}
