import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { WorkbookAdapter } from '../server/data/adapter.js';
import { csvRows,table,workbookRows,importBounds } from '../server/data/import.js';
import { evaluate } from '../server/data/query.js';
import { ApiService } from '../server/http/service.js';
import type { Dataset } from '../shared/data.js';
import { readFile } from 'node:fs/promises';
const signal=new AbortController().signal;
const revenue='month,region,revenue\n2026-01-01,North,100\n2026-01-01,South,200\n2026-02-01,North,150\n2026-02-01,South,250\n';
const fixed=()=>new Date('2026-10-03T00:00:00.000Z');
async function imported(csv=revenue) {
  const adapter=new WorkbookAdapter({now:fixed});
  const dataset=await adapter.importDataset({format:'csv',name:'Synthetic revenue',contentBase64:Buffer.from(csv).toString('base64')},{signal});
  return {adapter,dataset};
}
test('synthetic monthly and regional totals, stable evidence and immutable copies',async()=> {
  const {adapter,dataset}=await imported();
  assert.equal(dataset.rowCount,4); assert.equal(dataset.freshness,'snapshot');
  assert.equal(dataset.columns[0]?.type,'date');
  const request={datasetId:dataset.id,groupBy:['region'],aggregates:[{op:'sum',field:'revenue',alias:'total'}]};
  const result=await adapter.query(dataset.id,request);
  assert.deepEqual(result.rows,[{region:'North',total:250},{region:'South',total:450}]);
  result.rows[0]!.total=999;
  assert.equal((await adapter.query(dataset.id,request)).rows[0]?.total,250);
  assert.equal((await adapter.query(dataset.id,request)).queryId,result.queryId);
  const monthly=await adapter.query(dataset.id,{...request,groupBy:['month']});
  assert.deepEqual(monthly.rows.map(r=>r.total),[300,400]);
});
test('CSV quoted commas/newlines, locale values, duplicate and missing headers',()=> {
  const parsed=table(csvRows(Buffer.from(',amount,amount\n"a,b", "bad",\n'.replace(' "bad"','"bad"'))));
  assert.deepEqual(parsed.columns.map(c=>c.name),['column_1','amount','amount_2']);
  assert.equal(parsed.rows[0]?.column_1,'a,b');
  assert.equal(table([['n'],['1.234,50'],['2,50']],'de-DE').rows[0]?.n,1234.5);
  assert.equal(table([['n'],['1,234.50']]).rows[0]?.n,1234.5);
  assert.equal(csvRows(Buffer.from('a\n"x\ny"'))[1]?.[0],'x\ny');
  assert.equal(table([['mixed'],[2],['hello']]).rows[0]?.mixed,'2');
});
test('malformed CSV, dates, oversized content and unknown query fields are rejected',async()=> {
  for(const csv of ['a\n"broken','a\n"closed"junk','']) assert.throws(()=>table(csvRows(Buffer.from(csv))));
  assert.throws(()=>table([['date'],['2026-02-30']]));
  assert.throws(()=>table([Array(101).fill('h')]));
  assert.throws(()=>csvRows(Buffer.from('a\n'+ 'x'.repeat(4097))));
  const {adapter,dataset}=await imported();
  await assert.rejects(()=>adapter.importDataset({format:'csv',name:'big',contentBase64:Buffer.alloc(importBounds.bytes+1,65).toString('base64')},{signal}));
  await assert.rejects(()=>adapter.query(dataset.id,{datasetId:dataset.id,sql:'SELECT *'}));
  await assert.rejects(()=>adapter.query(dataset.id,{datasetId:dataset.id,projection:['invented']}));
});
test('real XLSX parsing, sheet selection, formula rejection and invalid ZIP',async()=> {
  const fixture=await workbookRows(await readFile(new URL('./fixtures/synthetic-revenue.xlsx',import.meta.url)));
  assert.equal(table(fixture.rows).rows.reduce((s,r)=>s+Number(r.revenue),0),700);
  const workbook=new ExcelJS.Workbook();
  workbook.addWorksheet('Revenue').addRows(csvRows(Buffer.from(revenue)));
  workbook.addWorksheet('Other').addRows([['amount'],[10]]);
  const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed=await workbookRows(buffer,'Other');
  assert.deepEqual(parsed.sheets,['Revenue','Other']); assert.equal(table(parsed.rows).rows[0]?.amount,10);
  await assert.rejects(()=>workbookRows(buffer,'missing'));
  await assert.rejects(()=>workbookRows(Buffer.from('not a workbook')));
  workbook.getWorksheet('Other')!.getCell('A2').value={formula:'1+1',result:2};
  const formulaBuffer=Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(()=>workbookRows(formulaBuffer,'Other'),/Formula/);
});
test('empty aggregates, null ordering, count, limit and exact typed filters',()=> {
  const dataset:Dataset={id:'d',sourceId:'s',kind:'excel',name:'test',columns:[{name:'n',type:'number'},{name:'g',type:'string'}],rowCount:3,capturedAt:fixed().toISOString(),freshness:'sample'};
  const rows=[{n:null,g:'A'},{n:2,g:'A'},{n:1,g:'B'}];
  const sorted=evaluate(dataset,rows,{datasetId:'d',projection:['n'],sort:[{field:'n',direction:'desc'}],limit:2});
  assert.deepEqual(sorted.rows,[{n:2},{n:1}]); assert.equal(sorted.truncated,true);
  assert.equal(evaluate(dataset,rows,{datasetId:'d',aggregates:[{op:'count',field:'n',alias:'n'}]}).rows[0]?.n,2);
  assert.deepEqual(evaluate(dataset,[],{datasetId:'d',aggregates:[{op:'sum',field:'n',alias:'sum'},{op:'count',alias:'count'}]}).rows,[{sum:null,count:0}]);
  assert.deepEqual(evaluate(dataset,[],{datasetId:'d',groupBy:['g'],aggregates:[{op:'count',alias:'count'}]}).rows,[]);
  assert.throws(()=>evaluate(dataset,rows,{datasetId:'d',filters:[{field:'n',op:'eq',value:{type:'string',value:'2'}}]}));
});
test('session service imports real CSV and rejects foreign dataset/evidence access',async()=> {
  const service=new ApiService({createAdapter:({signal})=>new WorkbookAdapter({signal,now:fixed})});
  const a=service.session().id,b=service.session().id;
  const {dataset}=await service.import(a,{format:'csv',name:'Revenue',contentBase64:Buffer.from(revenue).toString('base64')});
  const request={datasetId:dataset.id,aggregates:[{op:'sum',field:'revenue',alias:'total'}]};
  const {result}=await service.query(a,request); assert.equal(result.rows[0]?.total,700);
  await assert.rejects(()=>service.query(b,request)); assert.throws(()=>service.evidence(b,result.queryId));
  result.rows[0]!.total=-1; assert.equal(service.evidence(a,result.queryId).result.rows[0]?.total,700); service.close();
});
test('abort and disposed adapters cannot expose data',async()=> {
  const {adapter,dataset}=await imported(); const controller=new AbortController(); controller.abort();
  await assert.rejects(()=>adapter.query(dataset.id,{datasetId:dataset.id},{signal:controller.signal}));
  adapter.dispose(); await assert.rejects(()=>adapter.query(dataset.id,{datasetId:dataset.id}));
});
