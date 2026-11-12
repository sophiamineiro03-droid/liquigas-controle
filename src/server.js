import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createApp() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/api/health') {
      response.writeHead(200);
      response.end(JSON.stringify({ status: 'ok', service: 'liquigas-controle' }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'Rota não encontrada' }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um inteiro entre 1 e 65535');
  }
  const server = createApp();
  server.listen(port, '127.0.0.1', () => {
    console.log(`liquigas-controle iniciado na porta ${port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close());
  }
}
