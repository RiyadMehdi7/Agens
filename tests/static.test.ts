import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../server/http/router.js';

test('the built canvas is served from the API origin without exposing other files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'agens-web-'));
  const web = join(root, 'web');
  await mkdir(join(web, 'assets'), { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(web, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(join(root, 'secret.txt'), 'not public');
  // Bind first to learn the port, then build the real server with the exact origin it will be reached at.
  const holder = (await import('node:net')).createServer();
  await new Promise<void>(r => holder.listen(0, '127.0.0.1', r));
  const port = (holder.address() as AddressInfo).port;
  await new Promise<void>(r => holder.close(() => r()));
  const origin = `http://127.0.0.1:${port}`;
  const { server } = createApiServer({ origin, staticDir: web });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); });

  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await home.text(), /id="root"/);
  const csp = home.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /wss:\/\/generativelanguage\.googleapis\.com/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');

  const asset = await fetch(`${origin}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/);

  assert.match(await (await fetch(`${origin}/dashboards/123`)).text(), /id="root"/, 'client routes fall back to the shell');
  assert.equal((await fetch(`${origin}/assets/missing.js`)).status, 404);
  for (const path of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
    const response = await fetch(`${origin}${path}`);
    assert.doesNotMatch(await response.text(), /not public/, path);
  }
  const api = await fetch(`${origin}/api/nope`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type') ?? '', /json/);
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  assert.equal((await fetch(`${origin}/`, { headers: { Origin: 'https://evil.example' } })).status, 403);
});
