// Indicador do modo local, antes de ativar a conta. O transporte autenticado
// está em sync-engine.js. navigator.onLine nunca confirma envio por si só.
export function syncStatus(days, auditCount = 0) {
  const pending = auditCount + days.reduce((total, day) => total + 1 + day.movements.length + (day.closing ? 1 : 0), 0);
  return { configured: false, pending, label: 'Somente neste navegador — sincronização remota não configurada' };
}

// Fronteira de dados preparada para a integração futura; não envia requisições.
// O IndexedDB mantém strings vazias, enquanto o SQL usa NULL para "a definir".
export function deliveryToServer(value = {}) {
  const result = { ...value };
  for (const key of ['driver', 'status']) {
    if (Object.hasOwn(value, key)) result[key] = value[key] === '' || value[key] == null ? null : value[key];
  }
  return result;
}
export function deliveryFromServer(value = {}) {
  const result = { ...value };
  for (const key of ['driver', 'status']) {
    if (Object.hasOwn(value, key)) result[key] = value[key] ?? '';
  }
  return result;
}
