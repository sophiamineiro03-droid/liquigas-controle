import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function withApp(run) {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('endpoint de saúde responde com identificação do serviço', async () => {
  await withApp(async base => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'liquigas-controle' });
  });
});

test('rotas desconhecidas e métodos não implementados retornam 404', async () => {
  await withApp(async base => {
    for (const [path, method] of [['/desconhecida', 'GET'], ['/api/health', 'POST']]) {
      const response = await fetch(`${base}${path}`, { method });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'Rota não encontrada' });
    }
  });
});

test('serve a aplicação e assets offline com política de segurança e sem expor arquivos privados', async () => {
  await withApp(async base => {
    for (const path of ['/', '/app.js', '/domain.js', '/storage.js', '/sync.js', '/sale-form.js', '/sw.js', '/styles.css', '/manifest.webmanifest', '/icon.svg']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.ok((await response.text()).length > 0);
    }
    for (const path of ['/.env', '/.git/config', '/package.json', '/src/server.js', '/constructor', '/toString']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }
  });
});
