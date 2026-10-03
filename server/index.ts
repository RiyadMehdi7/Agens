import { createApiServer } from './http/router.js';
import { getConfig } from './config.js';

const config = getConfig();
const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${config.port}`;
// Supply createAdapter here when the separately owned data engine is integrated.
const { server } = createApiServer({ origin });
server.listen(config.port, '127.0.0.1', () => console.log(`Agens API skeleton listening on 127.0.0.1:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
