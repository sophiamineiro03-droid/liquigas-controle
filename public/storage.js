const DB_NAME = 'liquigas-controle';
const STORE = 'state';
let connection;
export function database() {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); location.reload(); };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Feche outras abas antigas e tente novamente.'));
  });
}
export async function load() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get('ledger');
    request.onsuccess = () => resolve(request.result ?? { version: 1, revision: 0, days: [] });
    request.onerror = () => reject(request.error);
  });
}
// A transação readwrite serializa gravações de abas diferentes. Uma revisão
// desatualizada é rejeitada em vez de sobrescrever lançamentos de outra aba.
export async function save(next, expectedRevision) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let failure;
    const read = store.get('ledger');
    read.onsuccess = () => {
      if ((read.result?.revision ?? 0) !== expectedRevision) {
        failure = new Error('Os dados mudaram em outra aba. A tela será atualizada; confira e repita a operação.');
        tx.abort();
        return;
      }
      store.put({ ...next, revision: expectedRevision + 1 }, 'ledger');
    };
    tx.oncomplete = () => resolve({ ...next, revision: expectedRevision + 1 });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Falha ao salvar os dados.'));
  });
}
