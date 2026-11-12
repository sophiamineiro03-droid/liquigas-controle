import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryToServer, deliveryFromServer, syncStatus } from '../public/sync.js';

test('fronteira de entrega converte vazio/NULL sem alterar documento ou presumir entrega', () => {
  const local = { driver: '', status: '', driverOther: '', assigneeId: null };
  const remote = deliveryToServer(local);
  assert.deepEqual(remote, { ...local, driver: null, status: null });
  assert.deepEqual(deliveryFromServer(remote), local);
  assert.equal(local.driver, '');
  for (const driver of ['Wagner', 'Vinicius', 'Depósito', 'Outro']) {
    const value = { driver, status: 'delivered', driverOther: 'Nome' };
    assert.deepEqual(deliveryFromServer(deliveryToServer(value)), value);
  }
  assert.deepEqual(deliveryToServer(), {});
  assert.deepEqual(deliveryToServer({ driver: '' }), { driver: null });
  assert.deepEqual(deliveryFromServer(), {});
  assert.deepEqual(deliveryFromServer({ status: null }), { status: '' });
  assert.equal(syncStatus([]).configured, false);
});
