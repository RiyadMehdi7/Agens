import { createApplication } from './app.js';
import { loadSourceRegistry } from './data/sources.js';
import { getConfig } from './config.js';

const config = getConfig();
const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${config.port}`;
const registry=await loadSourceRegistry(process.env.AGENS_SOURCES_FILE);
const importLocale=process.env.AGENS_IMPORT_LOCALE ?? 'en-US';
if(importLocale!=='en-US' && importLocale!=='de-DE') throw new Error('AGENS_IMPORT_LOCALE must be en-US or de-DE');
const { server } = createApplication({ origin,registry,importLocale });
server.listen(config.port, '127.0.0.1', () => console.log(`Agens data API listening on 127.0.0.1:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
