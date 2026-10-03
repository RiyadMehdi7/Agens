/** Repeatable sample-only smoke check against an already running local/Matrix application. */
import { readFile } from 'node:fs/promises';
const origin=process.env.AGENS_SMOKE_ORIGIN ?? 'http://127.0.0.1:5190';
const url=new URL(origin);
if(!['http:','https:'].includes(url.protocol) || url.origin!==origin || url.username || url.password) throw new Error('Expected exact application origin');
let cookie='';
async function call(path:string,body?:unknown) {
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',
    headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const set=response.headers.get('set-cookie');if(set) cookie=set.split(';')[0]!;
  const result=await response.json() as any;
  if(!response.ok) throw new Error(`Data check failed: HTTP ${response.status}`);
  return result;
}
const health=await call('/api/health');if(health.availability.data!=='ready') throw new Error('Data runtime is unavailable');
// Generated fixture only: no private uploaded files or credentials are read.
const contentBase64=(await readFile(new URL('../tests/fixtures/synthetic-revenue.xlsx',import.meta.url))).toString('base64');
const request={format:'xlsx',name:'Synthetic smoke revenue',contentBase64,sheet:'Revenue'};
const inspection=await call('/api/datasets/inspect',request);
if(!inspection.sheets.includes('Revenue')) throw new Error('Workbook discovery failed');
const {dataset}=await call('/api/datasets/import',request);
const {result}=await call('/api/query',{datasetId:dataset.id,aggregates:[{op:'sum',field:'revenue',alias:'total'}]});
if(result.rows[0]?.total!==700) throw new Error('Workbook total mismatch');
const evidence=await call(`/api/queries/${result.queryId}`);
if(evidence.result.rows[0]?.total!==700) throw new Error('Stored evidence mismatch');
console.log(JSON.stringify({health:health.availability.data,sheets:inspection.sheets,rows:dataset.rowCount,total:700,freshness:dataset.freshness,evidenceStored:true}));
