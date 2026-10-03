/**
 * End-to-end check of a running Agens app (local or Matrix, via `npm run demo`).
 * Uses only the committed synthetic workbook. With a server-side Gemini key it also exercises a real
 * Live token and a real Gemini 3.8 Flash plan; it never prints the token or any credential.
 */
import { readFile } from 'node:fs/promises';

const origin = process.env.AGENS_SMOKE_ORIGIN ?? 'http://127.0.0.1:5190';
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) throw new Error('Expected an exact application origin');

let cookie = '';
async function call(path: string, body?: unknown, timeout = 15_000): Promise<any> {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status} ${payload?.error?.code ?? ''} ${payload?.error?.message ?? ''}`.trim());
  return payload;
}
const check = (ok: boolean, what: string) => { if (!ok) throw new Error(`Check failed: ${what}`); };
const sum = (rows: Record<string, unknown>[], field: string) => rows.reduce((a, r) => a + (typeof r[field] === 'number' ? r[field] as number : 0), 0);

const report: Record<string, unknown> = { origin };

// 1. The canvas is served from the same origin.
const page = await fetch(origin + '/', { signal: AbortSignal.timeout(10_000) });
const html = await page.text();
check(page.ok && html.includes('id="root"'), `canvas served (HTTP ${page.status}; run npm run build)`);
report.canvas = 'served';

// 2. Health.
const health = await call('/api/health');
report.health = health.availability;
check(health.availability.data === 'ready', 'data runtime ready');

// 3. Synthetic workbook: discovery, import and known totals (700; North 250 / South 450; months 300 / 400).
const contentBase64 = (await readFile(new URL('../tests/fixtures/synthetic-revenue.xlsx', import.meta.url))).toString('base64');
const upload = { format: 'xlsx', name: 'Synthetic demo revenue', contentBase64, sheet: 'Revenue' };
const { sheets } = await call('/api/datasets/inspect', upload);
const { dataset } = await call('/api/datasets/import', upload);
const total = (await call('/api/query', { datasetId: dataset.id, aggregates: [{ op: 'sum', field: 'revenue', alias: 'total' }] })).result;
const regions = (await call('/api/query', { datasetId: dataset.id, groupBy: ['region'], aggregates: [{ op: 'sum', field: 'revenue', alias: 'total' }], sort: [{ field: 'region', direction: 'asc' }] })).result;
const months = (await call('/api/query', { datasetId: dataset.id, groupBy: ['month'], aggregates: [{ op: 'sum', field: 'revenue', alias: 'total' }], sort: [{ field: 'month', direction: 'asc' }] })).result;
check(total.rows[0]?.total === 700, 'total 700');
check(JSON.stringify(regions.rows.map((r: any) => r.total)) === '[250,450]', 'regions 250/450');
check(JSON.stringify(months.rows.map((r: any) => r.total)) === '[300,400]', 'months 300/400');
report.data = { sheets, rows: dataset.rowCount, freshness: dataset.freshness, total: 700, regions: [250, 450], months: [300, 400] };

// 4. Voice and planning, only when the server holds a key.
if (health.availability.voice === 'configured') {
  const token = await call('/api/live/token', {});
  check(typeof token.token === 'string' && token.token.length > 10 && token.model === 'gemini-3.8-live', 'Live token issued for gemini-3.8-live');
  report.liveToken = { model: token.model, expiresAt: token.expiresAt };
  const started = Date.now();
  const plan = await call('/api/dashboard/plan', { requestId: 'smoke_plan', prompt: 'Build a revenue dashboard by month and region',
    dashboard: { revision: 0, charts: [], selectedChartId: null }, evidence: [] }, 45_000);
  check(plan.charts.length > 0, 'planner returned at least one evidence-backed chart');
  for (const { chart, result } of plan.charts) {
    const stored = await call(`/api/queries/${result.queryId}`);
    check(stored.result.queryId === chart.queryId, `stored evidence for "${chart.title}"`);
    const value = chart.fields[chart.fields.length - 1];
    // Any chart summing revenue over all rows must reconcile with the known total.
    if (/sum\(revenue\)/.test(result.aggregation) && !result.truncated && result.normalizedRequest?.filters?.length === 0) {
      check(Math.abs(sum(result.rows, value) - 700) < 1e-9, `"${chart.title}" reconciles to 700`);
    }
  }
  report.plan = { model: 'gemini-3.8-flash', ms: Date.now() - started, summary: plan.summary, skipped: plan.skipped,
    charts: plan.charts.map((c: any) => ({ title: c.chart.title, kind: c.chart.kind, fields: c.chart.fields, rows: c.result.rows.length })) };
} else {
  report.voice = 'not configured on this server (no GEMINI_API_KEY); voice and planning skipped';
}

console.log(JSON.stringify(report, null, 2));
console.log('Demo smoke passed. This does not prove a spoken session; test the microphone in the browser.');
