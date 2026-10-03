import { createServer } from 'node:http';
import { getConfig } from './config.js';

const config = getConfig();
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/api/health') {
    res.end(JSON.stringify({ status: 'ok', stage: 'foundation', liveModel: config.liveModel,
      plannerModel: config.plannerModel, credentialsConfigured: config.configured,
      voiceImplemented: false, dataConnectorsImplemented: false }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Endpoint not implemented.' }));
  }
});
server.listen(config.port, '127.0.0.1', () => console.log(`Agens foundation: http://127.0.0.1:${config.port}/api/health`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
