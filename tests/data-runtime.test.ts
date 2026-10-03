import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { readFile,mkdtemp,writeFile,unlink,rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { createApplication } from '../server/app.js';
import { SourceRegistry, loadSourceRegistry } from '../server/data/sources.js';
const token='synthetic-fixture-token-32-characters-only';
const tokenHash=createHash('sha256').update(token).digest('hex');
async function harness(t:TestContext,registry?:SourceRegistry) {
  const app=createApplication({origin:'http://127.0.0.1',registry});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const address=app.server.address();assert.ok(address && typeof address!=='string');
  t.after(async()=> {app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()));});
  const client=()=> {
    let cookie='';
    return async(path:string,body?:unknown)=>new Promise<{status:number;body:any}>((resolve,reject)=> {
      const req=request({host:'127.0.0.1',port:address.port,path,method:body===undefined?'GET':'POST',headers:{Host:'127.0.0.1',Cookie:cookie,'Content-Type':'application/json'}},res=> {
        const chunks:Buffer[]=[];const set=res.headers['set-cookie']?.[0];if(set) cookie=set.split(';')[0]!;
        res.on('data',c=>chunks.push(c));res.on('error',reject);
        res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString())}));
      });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
  };
  return {client,service:app.service};
}
test('production runtime enables CSV/XLSX import, sheet discovery, query and immutable evidence over real HTTP',async t=> {
  const {client}=await harness(t);const owner=client(),other=client();
  const health=await owner('/api/health');assert.equal(health.body.availability.data,'ready');
  const contentBase64=(await readFile(new URL('./fixtures/synthetic-revenue.xlsx',import.meta.url))).toString('base64');
  const workbook={format:'xlsx',name:'Synthetic revenue',contentBase64};
  assert.deepEqual((await owner('/api/datasets/inspect',workbook)).body.sheets,['Revenue']);
  const imported=await owner('/api/datasets/import',{...workbook,sheet:'Revenue'});assert.equal(imported.status,201);
  const id=imported.body.dataset.id;
  const q={datasetId:id,aggregates:[{op:'sum',field:'revenue',alias:'total'}]};
  const result=await owner('/api/query',q);assert.equal(result.status,200);assert.equal(result.body.result.rows[0].total,700);
  assert.equal((await owner(`/api/queries/${result.body.result.queryId}`)).body.result.rows[0].total,700);
  assert.equal((await other('/api/query',q)).status,404);
  assert.equal((await other(`/api/datasets/${id}/refresh`,{})).status,404);
  assert.equal((await owner(`/api/datasets/${id}/status`)).body.state,'snapshot');
  assert.equal((await owner(`/api/datasets/${id}/refresh`,{})).status,400);
  const csv=await owner('/api/datasets/import',{format:'csv',name:'CSV',contentBase64:Buffer.from('amount\n10\n20').toString('base64')});
  const csvResult=await owner('/api/tools/execute',{name:'query_data',arguments:{datasetId:csv.body.dataset.id,aggregates:[{op:'sum',field:'amount',alias:'total'}]}});
  assert.equal(csvResult.body.result.rows[0].total,30);
});
test('private source config rejects malformed/unsafe definitions and never serializes tokens',async()=> {
  const registry=new SourceRegistry({sources:[{id:'api',tokenHash,kind:'https',source:{endpoint:'https://api.example.com/data',allowedOrigins:['https://api.example.com'],name:'API',headers:{Authorization:'synthetic-private-header'}}}]});
  assert.equal(JSON.stringify(registry).includes('synthetic-private-header'),false);
  assert.throws(()=>registry.claim({sourceId:'api',accessToken:'invalid'},'session'));
  assert.throws(()=>new SourceRegistry({sources:[{id:'api',tokenHash,kind:'https',source:{endpoint:'http://localhost/',allowedOrigins:['http://localhost'],name:'API'}}]}));
  await assert.rejects(()=>loadSourceRegistry('relative.json'));
});
test('operator file loads privately and source claims release only for their owner',async t=> {
  const dir=await mkdtemp(join(tmpdir(),'agens-config-test-')),file=join(dir,'sources.json');
  t.after(async()=>{await unlink(file);await rmdir(dir);});
  const config={sources:[{id:'api',tokenHash,kind:'https',source:{endpoint:'https://api.example.com/data',allowedOrigins:['https://api.example.com'],name:'API',headers:{Authorization:'synthetic-private-header'}}}]};
  await writeFile(file,JSON.stringify(config),{mode:0o600});
  const registry=await loadSourceRegistry(file);
  registry.claim({sourceId:'api',accessToken:token},'owner');
  assert.throws(()=>registry.claim({sourceId:'api',accessToken:token},'other'));
  registry.release('api','other');assert.throws(()=>registry.claim({sourceId:'api',accessToken:token},'other'));
  registry.release('api','owner');assert.ok(registry.claim({sourceId:'api',accessToken:token},'other'));
  assert.equal(JSON.stringify(registry).includes('synthetic-private-header'),false);
});
test('source attach endpoint rejects arbitrary credentials/URLs and unconfigured sources',async t=> {
  const {client}=await harness(t);const call=client();
  assert.equal((await call('/api/sources/connect',{sourceId:'missing',accessToken:token})).status,404);
  assert.equal((await call('/api/sources/connect',{sourceId:'missing',accessToken:token,url:'https://evil.example',password:'not-accepted'})).status,400);
  assert.equal((await call('/api/datasets/inspect',{format:'csv',name:'bad',contentBase64:'YQ==',sql:'DROP'})).status,400);
});

const databaseUrl=process.env.AGENS_TEST_POSTGRES_URL;
test('real Postgres through production HTTP: SELECT-only account, attach, query, refresh, owner isolation, failure status',
  {skip:!databaseUrl},async t=> {
    const registry=new SourceRegistry({sources:[{id:'revenue',tokenHash,kind:'postgres',connection:{connectionString:databaseUrl},source:{schema:'analytics',table:'revenue',columns:[{name:'id',type:'number'},{name:'region',type:'string'},{name:'amount',type:'number'}],orderBy:['id']}}]});
    const {client,service}=await harness(t,registry);const owner=client(),other=client();
    const attached=await owner('/api/sources/connect',{sourceId:'revenue',accessToken:token});assert.equal(attached.status,201,JSON.stringify(attached.body));
    const d=attached.body.dataset;assert.equal(d.freshness,'live');assert.equal(d.rowCount,4);
    assert.equal((await other('/api/sources/connect',{sourceId:'revenue',accessToken:token})).status,404);
    const result=await owner('/api/query',{datasetId:d.id,groupBy:['region'],aggregates:[{op:'sum',field:'amount',alias:'total'}],sort:[{field:'region',direction:'asc'}]});
    assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body.result.rows,[{region:'North',total:250},{region:'South',total:450}]);
    assert.equal((await other('/api/query',{datasetId:d.id})).status,404);
    const refreshed=await owner(`/api/datasets/${d.id}/refresh`,{});assert.equal(refreshed.status,200);assert.equal(refreshed.body.dataset.id,d.id);
    const readonly=new pg.Client({connectionString:databaseUrl});await readonly.connect();
    try {await assert.rejects(()=>readonly.query("INSERT INTO analytics.revenue VALUES (5,'North',1)"));} finally {await readonly.end();}
    assert.equal(JSON.stringify(result.body).includes('connectionString'),false);
    const adminUrl=process.env.AGENS_TEST_POSTGRES_ADMIN_URL;
    if(adminUrl) {
      const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
      try {
        await admin.query('REVOKE SELECT ON analytics.revenue FROM agens_reader');
        assert.equal((await owner(`/api/datasets/${d.id}/refresh`,{})).status,503);
        const failed=await owner(`/api/datasets/${d.id}/status`);assert.equal(failed.body.state,'failed');
        assert.equal(failed.body.lastVerifiedAt,refreshed.body.dataset.capturedAt);
        assert.equal((await owner(`/api/queries/${result.body.result.queryId}`)).body.result.rows[0].total,250);
        await admin.query('GRANT SELECT ON analytics.revenue TO agens_reader');
        assert.equal((await owner(`/api/datasets/${d.id}/refresh`,{})).status,200);
        assert.equal((await owner(`/api/datasets/${d.id}/status`)).body.state,'verified');
      } finally {await admin.query('GRANT SELECT ON analytics.revenue TO agens_reader');await admin.end();}
    }
    service.close();
  });

test('real public HTTPS JSON API through production HTTP: attach, query, refresh and evidence',
  {skip:process.env.AGENS_TEST_PUBLIC_API!=='1'},async t=> {
    const registry=new SourceRegistry({sources:[{id:'posts',tokenHash,kind:'https',source:{endpoint:'https://jsonplaceholder.typicode.com/posts',allowedOrigins:['https://jsonplaceholder.typicode.com'],name:'Public synthetic posts'}}]});
    const {client}=await harness(t,registry);const call=client();
    const attached=await call('/api/sources/connect',{sourceId:'posts',accessToken:token});assert.equal(attached.status,201,JSON.stringify(attached.body));
    const id=attached.body.dataset.id;
    const result=await call('/api/query',{datasetId:id,aggregates:[{op:'count',alias:'posts'}]});assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(result.body.result.rows[0].posts,attached.body.dataset.rowCount);assert.ok(result.body.result.rows[0].posts>0);
    assert.equal((await call(`/api/datasets/${id}/refresh`,{})).status,200);
    assert.equal((await call(`/api/datasets/${id}/status`)).body.state,'verified');
  });
test('real Postgres rejects write-capable roles, excessive rows and slow sources',
  {skip:!databaseUrl || !process.env.AGENS_TEST_POSTGRES_ADMIN_URL},async t=> {
    const adminUrl=process.env.AGENS_TEST_POSTGRES_ADMIN_URL!;
    const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
    const suffix=Date.now().toString(36),big=`fixture_big_${suffix}`,slow=`fixture_slow_${suffix}`;
    try {
      await admin.query(`CREATE VIEW analytics.${big} AS SELECT id, 'North'::text AS region, 1::numeric AS amount FROM generate_series(1,10001) id`);
      await admin.query(`CREATE VIEW analytics.${slow} AS SELECT r.* FROM analytics.revenue r CROSS JOIN (SELECT pg_sleep(10)) s`);
      await admin.query(`GRANT SELECT ON analytics.${big}, analytics.${slow} TO agens_reader`);
      const configured=(id:string,table:string,connectionString:string)=>({id,tokenHash,kind:'postgres',connection:{connectionString},source:{schema:'analytics',table,columns:[{name:'id',type:'number'},{name:'region',type:'string'},{name:'amount',type:'number'}],orderBy:['id']}});
      const {client}=await harness(t,new SourceRegistry({sources:[configured('big',big,databaseUrl!),configured('slow',slow,databaseUrl!),configured('unsafe','revenue',adminUrl)]}));
      const call=client();
      assert.equal((await call('/api/sources/connect',{sourceId:'unsafe',accessToken:token})).status,503);
      assert.equal((await call('/api/sources/connect',{sourceId:'big',accessToken:token})).status,503);
      const start=Date.now();assert.equal((await call('/api/sources/connect',{sourceId:'slow',accessToken:token})).status,503);
      assert.ok(Date.now()-start<4500,'statement deadline must stop the slow query');
      assert.deepEqual((await call('/api/datasets')).body.datasets,[]);
    } finally {
      await admin.query(`DROP VIEW IF EXISTS analytics.${big}, analytics.${slow}`);await admin.end();
    }
  });
