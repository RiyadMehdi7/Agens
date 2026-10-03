import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { validateQueryForDataset, datasetSchema, type Dataset } from '../../shared/data.js';
import { evaluate, type Row } from './query.js';
export interface PostgresSource {
  schema: string; table: string; columns: Dataset['columns']; orderBy: string[];
}
const identifier=(value:string)=> { if(!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid configured identifier'); return `"${value}"`; };
export function compilePostgres(source:PostgresSource,dataset:Dataset,input:unknown) {
  const q=validateQueryForDataset(input,dataset), values: unknown[]=[];
  if(!source.orderBy.length || source.orderBy.some(f=>!source.columns.some(c=>c.name===f))) throw new Error('Stable order columns required');
  const param=(v:unknown)=> {values.push(v); return `$${values.length}`;};
  const predicates=q.filters.map(f=> {
    const field=identifier(f.field);
    if(f.op==='in') return `(${f.values.map(v=>`${field} IS NOT DISTINCT FROM ${param(v.value)}`).join(' OR ')})`;
    const op={eq:'IS NOT DISTINCT FROM',ne:'IS DISTINCT FROM',gt:'>',gte:'>=',lt:'<',lte:'<='}[f.op];
    return `${field} ${op} ${param(f.value.value)}`;
  });
  return { text:`SELECT ${source.columns.map(c=>identifier(c.name)).join(', ')} FROM ${identifier(source.schema)}.${identifier(source.table)}${predicates.length ? ' WHERE '+predicates.join(' AND ') : ''} ORDER BY ${source.orderBy.map(f=>identifier(f)+' ASC NULLS LAST').join(', ')} LIMIT 10001`, values, request:q };
}
/** Credentials are retained only by this private server-side pool, never in dataset records. */
export class PostgresAdapter {
  #pool: pg.Pool;
  private dataset:Dataset;
  constructor(connection:pg.PoolConfig,private source:PostgresSource) {
    source=structuredClone(source); this.source=source;
    identifier(source.schema); identifier(source.table); source.columns.forEach(c=>identifier(c.name));
    if(!source.orderBy.length || source.orderBy.some(f=>!source.columns.some(c=>c.name===f))) throw new Error('Stable order columns required');
    this.#pool=new pg.Pool({...connection,max:1,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,query_timeout:4000});
    this.dataset={id:randomUUID(),sourceId:randomUUID(),kind:'database',name:`${source.schema}.${source.table}`,columns:source.columns,rowCount:0,capturedAt:new Date(0).toISOString(),freshness:'snapshot'};
    datasetSchema.parse(this.dataset);
  }
  async query(datasetId:string,input:unknown,context?:{signal:AbortSignal}) {
    if(datasetId!==this.dataset.id) throw new Error('Unknown dataset');
    const compiled=compilePostgres(this.source,this.dataset,input);
    context?.signal.throwIfAborted();
    const client=await this.#pool.connect(); let destroy=false;
    const abort=()=> {destroy=true; client.release(true);};
    context?.signal.addEventListener('abort',abort,{once:true});
    try {
      context?.signal.throwIfAborted();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      const role=await client.query<{safe:boolean}>("SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS safe FROM pg_roles WHERE rolname = current_user");
      if(role.rows[0]?.safe!==true) throw new Error('Unsafe database role');
      const privileges=await client.query<{safe:boolean}>("SELECT has_table_privilege(current_user, $1, 'SELECT') AND NOT (has_table_privilege(current_user, $1, 'INSERT') OR has_table_privilege(current_user, $1, 'UPDATE') OR has_table_privilege(current_user, $1, 'DELETE') OR has_table_privilege(current_user, $1, 'TRUNCATE') OR has_table_privilege(current_user, $1, 'TRIGGER')) AS safe",[`${identifier(this.source.schema)}.${identifier(this.source.table)}`]);
      if(privileges.rows[0]?.safe!==true) throw new Error('SELECT-only database role required');
      const result=await client.query(compiled.text,compiled.values);
      if(result.rows.length>10000) throw new Error('Database source exceeds complete-query row bound');
      const rows:Row[]=result.rows.map((r:Record<string,unknown>)=>Object.fromEntries(this.source.columns.map(c=> {
        let v=r[c.name];
        if(v===null || v===undefined) return [c.name,null];
        if(c.type==='number' && typeof v==='string' && /^[-+]?\d+(\.\d+)?$/.test(v)) v=Number(v);
        if(c.type==='date') { const d=v instanceof Date?v:new Date(String(v)); v=d.toISOString(); }
        if(typeof v!== (c.type==='date'?'string':c.type) || typeof v==='number' && !Number.isFinite(v) || typeof v==='string' && v.length>4096) throw new Error('Database cell type mismatch');
        return [c.name,v];
      })) as Row);
      await client.query('COMMIT'); context?.signal.throwIfAborted();
      const captured={...this.dataset,rowCount:rows.length,capturedAt:new Date().toISOString(),freshness:'live' as const};
      const evidence=evaluate(captured,rows,compiled.request); this.dataset=captured; return evidence;
    } catch { if(!destroy) await client.query('ROLLBACK').catch(()=>{}); throw new Error('Database operation failed'); }
    finally {context?.signal.removeEventListener('abort',abort); if(!destroy) client.release();}
  }
  async listDatasets() {return [structuredClone(this.dataset)];}
  async dispose() {await this.#pool.end();}
}
