import { prepareState } from './commerce.js';
import { appendOutbox } from './sync-commands.js';
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
    request.onsuccess = () => resolve(prepareState(request.result ?? { version: 1, revision: 0, days: [] }));
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
      try { next = appendOutbox(prepareState(read.result ?? { days: [] }), next); }
      catch (error) { failure=error; tx.abort(); return; }
      store.put({ ...next, revision: expectedRevision + 1 }, 'ledger');
    };
    tx.oncomplete = () => resolve({ ...next, revision: expectedRevision + 1 });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Falha ao salvar os dados.'));
  });
}

// Metadados de sincronização e projeções remotas compartilham a transação do ledger.
// Nunca chamar save() para aplicar uma resposta remota: isso criaria novo comando.
export async function updateStored(transform) {
  const db = await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'), store=tx.objectStore(STORE);
    let result, failure;
    const request=store.get('ledger');
    request.onsuccess=()=>{
      try {
        const current=prepareState(request.result ?? { version:1,revision:0,days:[] });
        const next=transform(structuredClone(current));
        if (!next || JSON.stringify(next)===JSON.stringify(current)) {result=current;return;}
        result={...next,revision:(current.revision??0)+1}; store.put(result,'ledger');
      } catch(error) {failure=error;tx.abort();}
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(failure??tx.error);
  });
}
