import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

for (const status of [404, 200]) {
  test(`demo smoke fails when the canvas is missing (HTTP ${status})`, async t => {
    // Keep all data checks healthy: a missing canvas must fail on its own.
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.url!);
      if (req.url === '/') {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end('<html><body>No canvas</body></html>');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/health') res.end(JSON.stringify({ availability: { data: 'ready', voice: 'unavailable' } }));
      else if (req.url === '/api/datasets/inspect') res.end(JSON.stringify({ sheets: ['Revenue'] }));
      else if (req.url === '/api/datasets/import') res.end(JSON.stringify({ dataset: { id: 'fixture', rowCount: 4, freshness: 'snapshot' } }));
      else if (req.url === '/api/query') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const group = JSON.parse(body).groupBy?.[0];
          const totals = group === 'region' ? [250, 450] : group === 'month' ? [300, 400] : [700];
          res.end(JSON.stringify({ result: { rows: totals.map(total => ({ total })) } }));
        });
      } else { res.writeHead(404); res.end('{}'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(run(process.execPath, ['--import', 'tsx', 'scripts/demo-smoke.ts'], {
      cwd: process.cwd(), env: { ...process.env, AGENS_SMOKE_ORIGIN: `http://127.0.0.1:${address.port}` }, timeout: 15_000,
    }), error => {
      const failure = error as Error & { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr, /Check failed: canvas served/);
      assert.doesNotMatch(failure.stdout, /Demo smoke passed/);
      return true;
    });
    assert.deepEqual(requests, ['/'], 'stop before checking data or contacting a provider');
  });
}
