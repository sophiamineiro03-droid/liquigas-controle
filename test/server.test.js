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
