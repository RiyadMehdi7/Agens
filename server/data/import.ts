import yauzl from 'yauzl';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { TextDecoder } from 'node:util';
import type { Dataset } from '../../shared/data.js';
import type { Row, Cell } from './query.js';
export const importBounds = { bytes: 256*1024, expandedBytes: 8*1024*1024, rows: 10000, columns: 100, sheets: 20, cells: 100000, cellLength: 4096 };
export function csvRows(buffer: Buffer): unknown[][] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > importBounds.columns) throw new Error('Column limit exceeded'); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > importBounds.rows+1) throw new Error('Row limit exceeded'); };
  for (let i=0; i<text.length; i++) {
    const c = text[i]!;
    if (quoted) { if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else { quoted=false; closed=true; } } else cell += c; }
    else if (c === '"') { if (cell || closed) throw new Error('Invalid CSV quoting'); quoted=true; }
    else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') { if(c === '\r' && text[i+1] === '\n') i++; pushRow(); }
    else { if (closed) throw new Error('Invalid CSV after quote'); cell += c; }
    if (cell.length > importBounds.cellLength) throw new Error('Cell limit exceeded');
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (cell || row.length || closed) pushRow();
  return rows;
}
/** Bound declared ZIP expansion before ExcelJS inflates XML; reject encrypted/macro payloads. */
function validateZip(buffer: Buffer) {
  let end = -1;
  for(let i=buffer.length-22; i>=Math.max(0,buffer.length-65557); i--) if(buffer.readUInt32LE(i) === 0x06054b50) {end=i; break;}
  if(end < 0) throw new Error('Invalid XLSX ZIP');
  const count = buffer.readUInt16LE(end+10); let offset=buffer.readUInt32LE(end+16), expanded=0;
  if(count > 500 || count === 0 || buffer.readUInt16LE(end+4) || buffer.readUInt16LE(end+6)) throw new Error('Unsupported XLSX ZIP');
  for(let i=0;i<count;i++) {
    if(offset+46 > buffer.length || buffer.readUInt32LE(offset)!==0x02014b50) throw new Error('Invalid XLSX directory');
    const size=buffer.readUInt32LE(offset+24), n=buffer.readUInt16LE(offset+28), extra=buffer.readUInt16LE(offset+30), comment=buffer.readUInt16LE(offset+32);
    const name=buffer.subarray(offset+46,offset+46+n).toString('utf8');
    if(buffer.readUInt16LE(offset+8)&1 || /vbaProject|\.bin$|(^|\/)\.\.(\/|$)/i.test(name)) throw new Error('Unsupported workbook content');
    expanded+=size; if(expanded>importBounds.expandedBytes) throw new Error('Workbook expansion limit exceeded');
    offset+=46+n+extra+comment;
  }
}
export async function workbookRows(buffer: Buffer, sheet?: string): Promise<{ sheets: string[]; rows: unknown[][] }> {
  validateZip(buffer);
  await new Promise<void>((resolve,reject)=> {
    yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=> {
      if(error || !zip) { reject(new Error('Invalid workbook archive')); return; }
      let bytes=0;
      const fail=(error:unknown)=> {zip.close(); reject(error);};
      zip.on('error',fail); zip.on('end',resolve);
      zip.on('entry',entry=> {
        if(entry.fileName.endsWith('/')) {zip.readEntry(); return;}
        zip.openReadStream(entry,(error,stream)=> {
          if(error || !stream) {fail(new Error('Invalid workbook entry')); return;}
          stream.on('error',fail);
          stream.on('data',(chunk:Buffer)=> {bytes+=chunk.length; if(bytes>importBounds.expandedBytes) {stream.destroy(); fail(new Error('Workbook expansion limit exceeded'));}});
          stream.on('end',()=>zip.readEntry());
        });
      });
      zip.readEntry();
    });
  });
  // XML parsing may allocate sparse rows before dimension checks; isolate its heap and time.
  return new Promise((resolve,reject)=> {
    const worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const ExcelJS=require(workerData.module);
      (async()=> {
        const workbook=new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(workerData.buffer));
        const bounds=workerData.bounds;
        if(workbook.worksheets.length>bounds.sheets) throw new Error('Sheet limit exceeded');
        const selected=workerData.sheet?workbook.getWorksheet(workerData.sheet):workbook.worksheets[0];
        if(!selected) throw new Error('Unknown or missing sheet');
        let total=0;
        for(const ws of workbook.worksheets) {
          if(ws.rowCount>bounds.rows+1 || ws.columnCount>bounds.columns) throw new Error('Workbook dimension limit exceeded');
          total+=ws.rowCount*ws.columnCount;
        }
        if(total>bounds.cells) throw new Error('Workbook cell limit exceeded');
        const rows=[];
        for(let i=1;i<=selected.rowCount;i++) {
          const row=[];
          for(let j=1;j<=selected.columnCount;j++) {
            const value=selected.getCell(i,j).value;
            if(value && typeof value==='object' && !(value instanceof Date)) {
              if('formula' in value || 'sharedFormula' in value) throw new Error('Formula cells are unsupported; export values first');
              if('richText' in value) row.push(value.richText.map(v=>v.text).join(''));
              else if('hyperlink' in value) row.push(value.text);
              else throw new Error('Unsupported workbook cell');
            } else row.push(value);
          }
          rows.push(row);
        }
        parentPort.postMessage({sheets:workbook.worksheets.map(s=>s.name),rows});
      })().catch(error=>parentPort.postMessage({error:error.message}));
    `,{eval:true,workerData:{buffer,sheet,bounds:importBounds,module:createRequire(import.meta.url).resolve('exceljs')},
      resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16},execArgv:[]});
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('Workbook parsing timeout'));},4000);
    worker.once('message',(result:{error?:string;sheets:string[];rows:unknown[][]})=> {
      clearTimeout(timer); void worker.terminate();
      if(result.error) reject(new Error(result.error)); else resolve(result);
    });
    worker.once('error',()=> {clearTimeout(timer); reject(new Error('Workbook parser resource limit'));});
    worker.once('exit',code=> {clearTimeout(timer); if(code!==0) reject(new Error('Workbook parser stopped'));});
  });
}
function normalize(value: unknown, locale: 'en-US'|'de-DE'): Cell {
  if(value === null || value === undefined || value === '') return null;
  if(value instanceof Date) { if(!Number.isFinite(value.getTime())) throw new Error('Invalid date'); return value.toISOString(); }
  if(typeof value === 'number') { if(!Number.isFinite(value)) throw new Error('Invalid number'); return value; }
  if(typeof value === 'boolean') return value;
  if(typeof value !== 'string' || value.length>importBounds.cellLength) throw new Error('Unsupported cell');
  const s=value.trim(); if(!s) return null;
  if(/^(true|false)$/i.test(s)) return s.toLowerCase()==='true';
  if(/^\d{4}-\d{2}-\d{2}(T.*Z)?$/.test(s)) {
    const date=new Date(s); const iso=date.toISOString();
    if(iso.slice(0,10)!==s.slice(0,10)) throw new Error('Invalid date'); return iso;
  }
  const pattern=locale==='de-DE' ? /^[-+]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/ : /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if(pattern.test(s) && !/^[-+]?0\d/.test(s)) {
    const n=Number(locale==='de-DE' ? s.replaceAll('.','').replace(',','.') : s.replaceAll(',',''));
    if(Number.isFinite(n)) return n;
  }
  return value;
}
export function table(rows: unknown[][], locale: 'en-US'|'de-DE'='en-US') {
  if(!rows.length || !rows[0]?.length) throw new Error('Empty table');
  const width=Math.max(...rows.map(r=>r.length));
  if(width>importBounds.columns || rows.length-1>importBounds.rows || width*rows.length>importBounds.cells) throw new Error('Table limit exceeded');
  const used=new Set<string>();
  const names=Array.from({length:width},(_,i)=> {
    let base=String(rows[0]?.[i] ?? '').trim() || `column_${i+1}`;
    if(['__proto__','prototype','constructor'].includes(base)) base=`column_${i+1}`;
    if(base.length>90) throw new Error('Header too long');
    let name=base, suffix=2; while(used.has(name)) name=`${base}_${suffix++}`; used.add(name); return name;
  });
  const raw=rows.slice(1).filter(r=>r.some(v=>v!==null && v!==undefined && v!==''));
  const normalized=raw.map(r=>names.map((_,i)=>normalize(r[i],locale)));
  const columns: Dataset['columns']=names.map((name,i)=> {
    const values=normalized.map(r=>r[i] ?? null).filter(v=>v!==null);
    let type: Dataset['columns'][number]['type']='string';
    if(values.length && values.every(v=>typeof v==='number')) type='number';
    else if(values.length && values.every(v=>typeof v==='boolean')) type='boolean';
    else if(values.length && values.every(v=>typeof v==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v))) type='date';
    return {name,type};
  });
  const data: Row[]=normalized.map((r,index)=>Object.fromEntries(columns.map((c,i)=> [c.name,r[i]===null || r[i]===undefined ? null : c.type==='string' ? String(raw[index]?.[i] ?? r[i]) : r[i]])));
  return {columns, rows:data, raw};
}
