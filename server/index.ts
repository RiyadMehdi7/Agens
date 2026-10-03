import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApplication } from './app.js';
import { loadSourceRegistry } from './data/sources.js';
import { getConfig } from './config.js';
import { createGeminiVoice } from './voice/gemini.js';

const config = getConfig();
const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${config.port}`;
const registry=await loadSourceRegistry(process.env.AGENS_SOURCES_FILE);
const importLocale=process.env.AGENS_IMPORT_LOCALE ?? 'en-US';
if(importLocale!=='en-US' && importLocale!=='de-DE') throw new Error('AGENS_IMPORT_LOCALE must be en-US or de-DE');
// Voice and planning are enabled only when the server holds a key; the browser never receives it.
const voice = config.configured ? createGeminiVoice(process.env.GEMINI_API_KEY!.trim()) : undefined;
// After `npm run build` the canvas lives in dist/web; serving it here makes one loopback port the whole app
// (the Matrix preview forwards just this port). In development Vite serves the canvas instead.
const built = [new URL('../web', import.meta.url), new URL('../dist/web', import.meta.url)].map(u => fileURLToPath(u))
  .find(dir => existsSync(`${dir}/index.html`));
const { server } = createApplication({ origin,registry,importLocale,voice,staticDir:built });
server.listen(config.port, '127.0.0.1', () => console.log(`Agens API listening on 127.0.0.1:${config.port}; voice ${voice ? 'configured' : 'not configured'}; canvas ${built ? `served from ${built}` : 'not built (use npm run dev:web)'}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
