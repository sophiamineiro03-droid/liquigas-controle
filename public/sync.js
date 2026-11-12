// Nenhum transporte remoto está configurado. Nunca marque dados como enviados
// somente porque navigator.onLine é true. Uma integração futura precisará de
// autenticação, idempotência por UUID e tratamento de conflitos no servidor.
export function syncStatus(days) {
  const pending = days.reduce((total, day) => total + 1 + day.movements.length + (day.closing ? 1 : 0), 0);
  return { configured: false, pending, label: 'Somente neste navegador — sincronização remota não configurada' };
}
