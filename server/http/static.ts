import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/**
 * The browser connects to Gemini Live directly (wss), loads Geist from Google Fonts and runs the
 * microphone AudioWorklet from a blob URL. Everything else is same-origin.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com",
  "media-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
].join('; ');

/** Serves the built canvas (dist/web) from the API's own origin, so one loopback port is the whole app. */
export function createStaticHandler(directory: string) {
  const root = resolve(directory);
  return async function serve(method: string, pathname: string, res: ServerResponse): Promise<boolean> {
    if ((method !== 'GET' && method !== 'HEAD') || pathname === '/api' || pathname.startsWith('/api/')) return false;
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { return false; }
    if (decoded.includes('\0')) return false;
    const target = resolve(join(root, normalize(decoded)));
    if (target !== root && !target.startsWith(root + sep)) return false;
    let file = target;
    let info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) {
      // Client-side routes fall back to the app shell; missing assets stay 404.
      if (extname(decoded)) return false;
      file = join(root, 'index.html');
      info = await stat(file).catch(() => undefined);
      if (!info?.isFile()) return false;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
      'Content-Security-Policy': contentSecurityPolicy,
    });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  };
}
