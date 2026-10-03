import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { idSchema } from '../../shared/data.js';
import { liveTokenRequestSchema, toolRequestSchema } from '../../shared/api.js';
import { ApiError, ApiService, type ServiceOptions } from './service.js';
import { createStaticHandler } from './static.js';

export interface HttpOptions extends ServiceOptions {
  /** Exact browser-facing origin, including the dev port. Do not derive from Host. */
  origin: string;
  maxBodyBytes?: number;
  /** Built canvas to serve from the same origin (dist/web). Omitted: API only. */
  staticDir?: string;
}
const cookieName = 'agens_session';
function readCookie(req: IncomingMessage): string | undefined {
  const matches = (req.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${cookieName}=`));
  if (matches.length > 1) throw new ApiError(401, 'UNAUTHORIZED', 'Session is invalid or expired.');
  return matches[0]?.slice(cookieName.length + 1);
}
async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') ||
      (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use uncompressed application/json.');
  }
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds byte limit.');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  // Event listeners avoid destroying the socket before a 413 can be delivered.
  const body = await new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const error = () => { cleanup(); reject(new ApiError(400, 'INVALID_REQUEST', 'Request body could not be read.')); };
    const aborted = () => error();
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        cleanup(); req.pause(); reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds byte limit.'));
      } else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(error, 5000);
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new ApiError(400, 'INVALID_REQUEST', 'Request body must be valid JSON.'); }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

export function createApiServer(options: HttpOptions) {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || !['http:', 'https:'].includes(origin.protocol)) throw new Error('Expected an exact HTTP origin');
  const maxBodyBytes = options.maxBodyBytes ?? 512 * 1024;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 512 * 1024) throw new Error('Invalid body limit');
  const service = new ApiService(options);
  const serveStatic = options.staticDir ? createStaticHandler(options.staticDir) : undefined;
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    void (async () => {
      try {
        if (req.headers.host !== origin.host || (req.headers.origin !== undefined && req.headers.origin !== origin.origin) ||
            (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) {
          throw new ApiError(403, 'FORBIDDEN', 'Origin is not allowed.');
        }
        if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', origin.origin); res.setHeader('Vary', 'Origin'); }
        const url = new URL(req.url ?? '/', origin);
        if (url.origin !== origin.origin || url.search) throw new ApiError(400, 'INVALID_REQUEST', 'Unexpected URL parameters.');
        if (req.method === 'GET' && url.pathname === '/api/health') { send(res, 200, service.health()); return; }
        if (serveStatic && await serveStatic(req.method ?? '', url.pathname, res)) return;
        const queryMatch = /^\/api\/queries\/([A-Za-z0-9_-]{1,80})$/.exec(url.pathname);
        const refreshMatch=/^\/api\/datasets\/([A-Za-z0-9_-]{1,80})\/refresh$/.exec(url.pathname);
        const statusMatch=/^\/api\/datasets\/([A-Za-z0-9_-]{1,80})\/status$/.exec(url.pathname);
        const known = (req.method === 'GET' && (url.pathname === '/api/datasets' || queryMatch || statusMatch)) ||
          (req.method === 'POST' && (refreshMatch || ['/api/datasets/import', '/api/datasets/inspect', '/api/sources/connect', '/api/query', '/api/live/token', '/api/dashboard/plan', '/api/tools/execute'].includes(url.pathname)));
        if (!known) throw new ApiError(404, 'NOT_FOUND', 'Route not found.');
        const body = req.method === 'POST' ? await readJson(req, maxBodyBytes) : undefined;
        const session = service.session(readCookie(req));
        if (session.issued) res.setHeader('Set-Cookie', `${cookieName}=${session.id}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(service.limits.sessionTtlMs / 1000)}${origin.protocol === 'https:' ? '; Secure' : ''}`);
        let result: unknown;
        let status = 200;
        if (queryMatch) result = service.evidence(session.id, idSchema.parse(queryMatch[1]));
        else if(statusMatch) result=service.sourceStatus(session.id,idSchema.parse(statusMatch[1]));
        else if(refreshMatch) {
          if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length) throw new ApiError(400,'INVALID_REQUEST','Refresh expects an empty object.');
          result=await service.refresh(session.id,idSchema.parse(refreshMatch[1]));
        }
        else switch (url.pathname) {
          case '/api/datasets': result = service.list(session.id); break;
          case '/api/datasets/import': result = await service.import(session.id, body); status = 201; break;
          case '/api/datasets/inspect': result=await service.inspect(session.id,body);break;
          case '/api/sources/connect': result=await service.connect(session.id,body);status=201;break;
          case '/api/query': result = await service.query(session.id, body); break;
          case '/api/live/token': liveTokenRequestSchema.parse(body); result = await service.live(session.id); break;
          case '/api/dashboard/plan': result = await service.plan(session.id, body); break;
          case '/api/tools/execute': {
            const tool = toolRequestSchema.parse(body);
            switch (tool.name) {
              case 'list_datasets': result = service.list(session.id); break;
              case 'query_data': result = await service.query(session.id, tool.arguments); break;
              case 'get_query': result = service.evidence(session.id, tool.arguments.queryId, tool.arguments.datasetId); break;
              case 'plan_dashboard': result = await service.plan(session.id, tool.arguments); break;
            }
            break;
          }
        }
        send(res, status, result);
      } catch (error) {
        const failure = error instanceof ApiError ? error : error instanceof ZodError
          ? new ApiError(400, 'INVALID_REQUEST', 'Request does not match the API contract.')
          : new ApiError(500, 'INTERNAL_ERROR', 'Request could not be completed.');
        // Do not drain attacker-controlled bodies or expose stack traces / provider errors.
        res.setHeader('Connection', 'close');
        if (failure.code === 'UNAUTHORIZED') res.setHeader('Set-Cookie', `${cookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${origin.protocol === 'https:' ? '; Secure' : ''}`);
        send(res, failure.status, { error: { code: failure.code, message: failure.message } });
      }
    })();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 10_000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 64;
  const cleanup = setInterval(() => service.prune(), Math.min(service.limits.sessionTtlMs, 30_000));
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); service.close(); });
  return { server, service };
}
