import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePostgres } from '../server/data/postgres.js';
import { allowedUrl,publicAddress,HttpsJsonAdapter } from '../server/data/https.js';
import type { Dataset } from '../shared/data.js';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import pg from 'pg';
import { PostgresAdapter } from '../server/data/postgres.js';
const dataset:Dataset={id:'d',sourceId:'s',name:'Revenue',kind:'database',columns:[{name:'region',type:'string'},{name:'amount',type:'number'}],rowCount:0,capturedAt:'2026-10-03T00:00:00.000Z',freshness:'sample'};
const source={schema:'analytics',table:'revenue',columns:dataset.columns,orderBy:['region']};
test('Postgres approved compilation parameterizes hostile literals and limits complete source reads',()=> {
  const attack="x'; DROP TABLE revenue;--";
  const query=compilePostgres(source,dataset,{datasetId:'d',filters:[{field:'region',op:'eq',value:{type:'string',value:attack}}]});
  assert.equal(query.text.includes(attack),false); assert.deepEqual(query.values,[attack]);
  assert.match(query.text,/IS NOT DISTINCT FROM \$1/); assert.match(query.text,/LIMIT 10001$/);
  assert.throws(()=>compilePostgres({...source,table:'revenue;DROP'},dataset,{datasetId:'d'}));
  assert.throws(()=>compilePostgres(source,dataset,{datasetId:'d',sql:'DROP TABLE revenue'}));
  assert.throws(()=>compilePostgres(source,dataset,{datasetId:'d',projection:['secret']}));
});
test('HTTPS rejects non-allowlisted origins, credentials and private/metadata destinations',()=> {
  for(const url of ['http://api.example.com/data','https://other.example.com/data','https://user:pass@api.example.com/data','https://127.0.0.1/data','https://169.254.169.254/data','https://[::1]/data','https://[::ffff:127.0.0.1]/data']) {
    const origin=new URL(url).origin;
    assert.throws(()=>allowedUrl(url,[origin==='https://other.example.com'?'https://api.example.com':origin]));
  }
  assert.equal(allowedUrl('https://api.example.com/data',['https://api.example.com']).pathname,'/data');
  for(const ip of ['10.0.0.1','172.16.0.1','192.168.0.1','100.64.0.1','0.0.0.0','::1','fc00::1','fe80::1','2001:db8::1','2001:0db8:0:0:0:0:0:1','2001:0000:0:0:0:0:0:1','2002:7f00:1::']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
});
test('unverified API exposes no live dataset and never serializes configured credentials',async()=> {
  const adapter=new HttpsJsonAdapter({endpoint:'https://api.example.com/data',allowedOrigins:['https://api.example.com'],name:'API',headers:{Authorization:'synthetic-test-token'}});
  assert.deepEqual(await adapter.listDatasets(),[]);
  assert.equal(JSON.stringify(adapter).includes('synthetic-test-token'),false);
  await assert.rejects(()=>adapter.query('unknown',{datasetId:'unknown'}),/Unknown dataset/);
});
test('HTTPS refresh pins public DNS, accumulates bounded pages, rejects redirects and redacts errors',async(t)=> {
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  let status=200,mode='normal',calls=0;
  t.mock.method(https,'get',(_url:URL,options:Record<string,unknown>,callback:(res:unknown)=>void)=> {
    calls++;
    assert.equal(typeof options.lookup,'function');
    const request=new EventEmitter() as EventEmitter & {destroy:(e:Error)=>void};
    request.destroy=e=>request.emit('error',e);
    queueMicrotask(()=> {
      const body=mode==='oversize'?'x'.repeat(256*1024+1):JSON.stringify({rows:[{region:'North',amount:100}],next:mode==='cycle'?'/data':undefined});
      const response=Readable.from([Buffer.from(body)]) as Readable & {statusCode:number;headers:Record<string,string>};
      response.statusCode=status;response.headers={'content-type':'application/json'}; callback(response);
    });
    return request;
  });
  const adapter=new HttpsJsonAdapter({endpoint:'https://api.example.com/data',allowedOrigins:['https://api.example.com'],name:'API',headers:{Authorization:'synthetic-secret'}});
  const first=await adapter.refresh(); assert.equal(first.dataset.freshness,'live');
  const result=await adapter.query(first.dataset.id,{datasetId:first.dataset.id,aggregates:[{op:'sum',field:'amount',alias:'total'}]});
  assert.equal(result.rows[0]?.total,100);
  status=302; await assert.rejects(()=>adapter.refresh(),/API refresh failed/); assert.equal(adapter.lastError,'API refresh failed');
  status=200;mode='cycle'; await assert.rejects(()=>adapter.refresh());
  mode='oversize';await assert.rejects(()=>adapter.refresh());
  assert.equal(calls,5);
  t.mock.method(dns,'lookup',async()=>[{address:'127.0.0.1',family:4}]);
  await assert.rejects(()=>adapter.refresh()); assert.equal(calls,5);
  assert.equal(JSON.stringify(await adapter.listDatasets()).includes('synthetic-secret'),false);
});
test('Postgres transaction uses read-only role guards, timeout, bounded rows and generic errors',async(t)=> {
  let safe=true,tooMany=false; const statements:string[]=[];
  const client={query:async(text:string)=> {
    statements.push(text);
    if(text.startsWith('SELECT NOT') || text.startsWith('SELECT has_table')) return {rows:[{safe}]};
    if(text.startsWith('SELECT "region"')) return {rows:tooMany?Array(10001).fill({region:'North',amount:10}):[{region:'North',amount:'10'}]};
    return {rows:[]};
  },release:()=>{}};
  t.mock.method(pg.Pool.prototype,'connect',async()=>client);
  t.mock.method(pg.Pool.prototype,'end',async()=>{});
  const adapter=new PostgresAdapter({password:'synthetic-test-password'},source);
  const d=(await adapter.listDatasets())[0]!;assert.equal(d.freshness,'snapshot');
  const result=await adapter.query(d.id,{datasetId:d.id,aggregates:[{op:'sum',field:'amount',alias:'total'}]});
  assert.equal(result.rows[0]?.total,10);assert.equal((await adapter.listDatasets())[0]?.freshness,'live');
  assert.ok(statements.includes('BEGIN READ ONLY'));assert.ok(statements.includes("SET LOCAL statement_timeout = '3000ms'"));
  safe=false;await assert.rejects(()=>adapter.query(d.id,{datasetId:d.id}),/Database operation failed/);
  safe=true;tooMany=true;await assert.rejects(()=>adapter.query(d.id,{datasetId:d.id}));assert.ok(statements.includes('ROLLBACK'));
  assert.equal(JSON.stringify(adapter).includes('synthetic-test-password'),false);await adapter.dispose();
});
