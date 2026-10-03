import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Dataset } from '../../shared/data.js';
import { validateQueryForDataset } from '../../shared/data.js';
import { table } from './import.js';
import { evaluate } from './query.js';
export function publicAddress(address:string) {
  if(isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a===169 && b===254 || a===172 && b!>=16 && b!<=31 || a===192 && (b===168 || b===0 || b===2) || a===198 && (b===18 || b===19 || b===51) || a===203 && b===0 || a!>=224 || a===100 && b!>=64 && b!<=127);
  }
  if(isIP(address)!==6) return false;
  const global=new BlockList(); global.addSubnet('2000::',3,'ipv6');
  const reserved=new BlockList();
  for(const [network,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) reserved.addSubnet(network,prefix,'ipv6');
  return global.check(address,'ipv6') && !reserved.check(address,'ipv6');
}
export function allowedUrl(input:string,origins:readonly string[]) {
  const url=new URL(input);
  if(url.protocol!=='https:' || url.username || url.password || url.hash || !origins.includes(url.origin) || url.port && url.port!=='443') throw new Error('URL is not allowed');
  if(url.hostname==='localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw new Error('Private target');
  const host=url.hostname.replace(/^\[|\]$/g,''); if(isIP(host) && !publicAddress(host)) throw new Error('Private target');
  return url;
}
async function page(url:URL,headers:Record<string,string>,signal?:AbortSignal):Promise<unknown> {
  signal?.throwIfAborted();
  const addresses=await new Promise<{address:string;family:number}[]>((resolve,reject)=> {
    const abort=()=>reject(new Error('DNS lookup aborted'));
    signal?.addEventListener('abort',abort,{once:true});
    dns.lookup(url.hostname,{all:true}).then(resolve,reject).finally(()=>signal?.removeEventListener('abort',abort));
    if(signal?.aborted) abort();
  });
  if(!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new Error('Private target');
  const pinned=addresses[0]!;
  return new Promise((resolve,reject)=> {
    const req=https.get(url,{headers,signal,timeout:3000,lookup:(_host,_options,callback)=>callback(null,pinned.address,pinned.family)},res=> {
      if(res.statusCode!==200 || !/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '') || res.headers['content-encoding'] && res.headers['content-encoding']!=='identity') {res.destroy(); reject(new Error('Unsupported API response')); return;}
      let bytes=0; const chunks:Buffer[]=[];
      res.on('data',(chunk:Buffer)=> {bytes+=chunk.length; if(bytes>256*1024) {res.destroy(new Error('Response limit'));} else chunks.push(chunk);});
      res.on('error',()=>reject(new Error('API response failed')));
      res.on('end',()=> {try {resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {reject(new Error('Invalid JSON'));}});
    });
    req.on('timeout',()=>req.destroy(new Error('API timeout')));
    req.on('error',()=>reject(new Error('API request failed')));
  });
}
export interface JsonSource { endpoint:string; allowedOrigins:string[]; headers?:Record<string,string>; name:string }
/** Only owner-configured endpoints; model query input cannot supply a URL or credentials. */
export class HttpsJsonAdapter {
  #source:JsonSource; private dataset:Dataset | undefined;
  lastError: string | undefined;
  constructor(source:JsonSource) { this.#source=structuredClone(source); allowedUrl(source.endpoint,source.allowedOrigins); }
  async refresh(signal?:AbortSignal) {
    const deadline=new AbortController(); const abort=()=>deadline.abort();
    signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted) abort();
    const timer=setTimeout(abort,4000);
    try {
      let url:URL|undefined=allowedUrl(this.#source.endpoint,this.#source.allowedOrigins);
      const all:Record<string,unknown>[]=[],seen=new Set<string>();
      for(let i=0;url && i<5;i++) {
        if(seen.has(url.href)) throw new Error('Pagination cycle'); seen.add(url.href);
        // Pagination cannot forward configured credentials to a different origin.
        if(url.origin!==new URL(this.#source.endpoint).origin) throw new Error('Pagination origin changed');
        const response=await page(url,this.#source.headers ?? {},deadline.signal);
        const object=response as {rows?:unknown;next?:unknown};
        if(!object || typeof object!=='object') throw new Error('Invalid API envelope');
        const rows=Array.isArray(response)?response:object.rows;
        if(!Array.isArray(rows) || rows.some(r=>!r || typeof r!=='object' || Array.isArray(r))) throw new Error('Expected JSON rows');
        all.push(...rows); if(all.length>10000) throw new Error('API row bound');
        if(object.next!==undefined && object.next!==null && typeof object.next!=='string') throw new Error('Invalid pagination');
        url=object.next ? allowedUrl(new URL(object.next as string,url).href,this.#source.allowedOrigins) : undefined;
      }
      if(url) throw new Error('Pagination bound exceeded');
      const names=[...new Set(all.flatMap(r=>Object.keys(r)))];
      if(names.some(n=>['__proto__','constructor','prototype'].includes(n))) throw new Error('Reserved JSON field');
      const parsed=table([names,...all.map(r=>names.map(n=>r[n]))]);
      const dataset:Dataset={id:this.dataset?.id ?? randomUUID(),sourceId:this.dataset?.sourceId ?? randomUUID(),kind:'api',name:this.#source.name,columns:parsed.columns,rowCount:parsed.rows.length,capturedAt:new Date().toISOString(),freshness:'live'};
      this.dataset=dataset; this.lastError=undefined; return {dataset:structuredClone(dataset),rows:parsed.rows};
    } catch {this.lastError='API refresh failed'; throw new Error(this.lastError);}
    finally {clearTimeout(timer); signal?.removeEventListener('abort',abort);}
  }
  async listDatasets() {return this.dataset?[structuredClone(this.dataset)]:[];}
  async query(datasetId:string,input:unknown,context?:{signal:AbortSignal}) {
    if(!this.dataset || datasetId!==this.dataset.id) throw new Error('Unknown dataset');
    validateQueryForDataset(input,this.dataset);
    const {dataset,rows}=await this.refresh(context?.signal); return evaluate(dataset,rows,input);
  }
}
