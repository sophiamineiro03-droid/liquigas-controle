import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const publicRoot = new URL('../public/', import.meta.url);
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/commerce.js': ['commerce.js', 'text/javascript; charset=utf-8'],
  '/commerce-ui.js': ['commerce-ui.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/domain.js': ['domain.js', 'text/javascript; charset=utf-8'],
  '/storage.js': ['storage.js', 'text/javascript; charset=utf-8'],
  '/sync.js': ['sync.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};

export function createApp() {
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch {
      response.writeHead(400);
      response.end(JSON.stringify({ error: 'Endereço inválido' }));
      return;
    }
    if (request.method === 'GET' && Object.hasOwn(assets, pathname)) {
      try {
        const [file, mime] = assets[pathname];
        const content = await readFile(new URL(file, publicRoot));
        response.writeHead(200, { 'Content-Type': mime });
        response.end(content);
      } catch {
        response.writeHead(500);
        response.end(JSON.stringify({ error: 'Não foi possível carregar a aplicação' }));
      }
      return;
    }
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
