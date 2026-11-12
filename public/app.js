import { report } from './commerce.js';
import { setupCommerce, dashboard, dailyDetails, renderCommerce, financialReport } from './commerce-ui.js';
import { money, summary, openDay, addMovement, reverseMovement, closeDay, TYPES, ACCOUNTS } from './domain.js';
import { load, save } from './storage.js';
import { syncStatus } from './sync.js';

const $ = selector => document.querySelector(selector);
const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
const dayDate = value => value.split('-').reverse().join('/');
const time = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let state, selectedHistory, busy = false;
let responsible = '';
let dialogAction, dialogRevision;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('liquigas-ledger') : null;

function showError(error) {
  $('#message').textContent = error.message || 'Não foi possível concluir a operação.';
  $('#message').hidden = false;
  $('#message').focus();
}
function field(name, title, type = 'text', value = '', extra = '') {
  return `<label>${title}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
}
const amount = (name, title, value = '') => field(name, title, 'text', value, 'inputmode="decimal" autocomplete="off" required maxlength="13" placeholder="0,00"');
const userField = (optional = false) => field('user', 'Responsável', 'text', responsible || state?.days.find(day => !day.closing)?.user || '', `${optional ? '' : 'required'} maxlength="100" autocomplete="name"`) + (optional ? '<small class="muted">Responsável opcional para saídas.</small>' : '');
const notes = (title = 'Observações (opcional)') => `<label>${title}<textarea name="notes" maxlength="500" rows="2"></textarea></label>`;
const description = () => '<label>Descrição / motivo<textarea name="description" required maxlength="500" rows="2"></textarea></label>';
const selectAccount = (name, title) => `<label>${title}<select name="${name}"><option value="cash">Caixa (fora do fundo)</option><option value="fund">Fundo de troco</option></select></label>`;
function metric(label, value, tone = '') { return `<div class="metric"><span>${label}</span><strong class="${tone}">${brl(value)}</strong></div>`; }
function movementTable(day, editable = false) {
  if (!day.movements.length) return '<p class="muted">Nenhuma movimentação registrada neste caixa.</p>';
  const reversed = new Set(day.movements.filter(m => m.reverses).map(m => m.reverses));
  return `<div class="table-wrap"><table><thead><tr><th>Horário / responsável</th><th>Movimentação</th><th>Caminho do dinheiro</th><th>Histórico</th></tr></thead><tbody>${[...day.movements].reverse().map(m => `<tr><td>${time(m.createdAt)}<small>${escape(m.user)}</small></td><td><strong>${TYPES[m.type]}</strong><small>${escape(m.description)}</small><small>${escape(m.notes ?? '')}</small><small>${m.type === 'sale' ? `Venda líquida: ${brl(m.saleAmount)}` : ''}</small><small>Local · envio pendente</small></td><td>${m.entries.map(leg => `<div>${ACCOUNTS[leg.from]} → ${ACCOUNTS[leg.to]}<br><strong class="amount">${brl(leg.amount)}</strong>${leg.kind === 'saleChange' ? '<small>Troco entregue ao cliente</small>' : ''}</div>`).join('')}</td><td>${m.reverses ? `<small>Estorno de ${escape(m.reverses)}</small>` : reversed.has(m.id) ? '<span class="badge closed">Estornado</span>' : editable && !m.commerceId ? `<button class="secondary" data-reverse="${m.id}">Estornar</button>` : 'Registrado'}<small>ID: ${escape(m.id)}</small></td></tr>`).join('')}</tbody></table></div>`;
}
function fundPanel(day) {
  const s = summary(day);
  return `<section class="panel fund"><div class="section-heading"><h2>Fundo de troco</h2><span class="badge ${s.missing ? 'closed' : ''}">${s.missing ? 'Reposição pendente' : s.excess ? 'Acima da referência' : 'Fundo completo'}</span></div><div class="cards">${metric('Valor de referência', day.referenceFund)}${metric('Disponível no fundo', s.fund)}${metric('Falta para recompor', s.missing, s.missing ? 'warning' : 'good')}${metric('Excedente', s.excess)}</div><p class="muted">Reposição é transferência do caixa para o fundo. Pendência de reposição não é diferença de conferência.</p><p><strong>Notas pequenas e moedas:</strong> ${day.smallNotesNeeded ? 'Faltam notas pequenas/moedas (sem alterar o saldo)' : 'Sem alerta de falta de notas pequenas'}</p>${!day.closing ? '<button id="small-notes" class="secondary">Conferir notas e moedas</button>' : ''}</section>`;
}
function closingPanel(day) {
  const c = day.closing;
  if (!c) return '';
  return `<section class="panel"><div class="section-heading"><h2>Fechamento · ${dayDate(day.date)}</h2><span class="badge closed">Fechado</span></div><p>Conferido por ${escape(c.user)} em ${time(c.createdAt)}.</p><div class="cards">${metric('Entradas físicas brutas', c.expected.income)}${metric('Saídas físicas brutas (inclui troco)', c.expected.expense)}${metric('Vendas em espécie (líquidas)', c.expected.sales)}${metric('Transferências (volume movimentado)', c.expected.transfers)}</div><div class="table-wrap"><table><thead><tr><th>Conferência</th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead><tbody><tr><td>Caixa, fora do fundo</td><td>${brl(c.expected.cash)}</td><td>${brl(c.countedCash)}</td><td>${brl(c.cashDifference)}</td></tr><tr><td>Fundo de troco</td><td>${brl(c.expected.fund)}</td><td>${brl(c.countedFund)}</td><td>${brl(c.fundDifference)}</td></tr><tr><td><strong>Total físico</strong></td><td>${brl(c.expected.total)}</td><td>${brl(c.countedCash + c.countedFund)}</td><td><strong>${brl(c.difference)}</strong></td></tr></tbody></table></div><p class="help">Reposição do fundo pelo saldo esperado: ${brl(c.expected.missing)}. Pelo dinheiro contado: ${brl(Math.max(0, day.referenceFund - c.countedFund))}. Esses valores não são perdas de caixa.</p><p>Observações: ${escape(c.notes || 'Sem observações.')}</p><p class="muted">Ajustes líquidos registrados: ${brl(c.expected.adjustments)}. Estornos estão incluídos no histórico. Transferências mostram o volume físico, incluindo devoluções e estornos.</p>${c.commerce ? financialReport(c.commerce, 'Resumo financeiro registrado no fechamento') : ''}<button data-print class="secondary">Imprimir resumo e histórico</button></section>`;
}
function renderCurrent() {
  const day = state.days.find(day => !day.closing);
  if (!day) {
    $('#current').innerHTML = `<section class="panel empty"><span class="eyebrow">PRONTO PARA COMEÇAR</span><h2>Nenhum caixa aberto</h2><p>Hoje: ${dayDate(today())}</p><p>Informe os saldos separados do caixa e do fundo de troco para iniciar o expediente. O fundo tem referência de R$ 100,00.</p><button id="open-day">Abrir caixa</button></section>`;
    return;
  }
  const s = summary(day);
  $('#current').innerHTML = `<div class="section-heading"><div><h2>Expediente de ${dayDate(day.date)}</h2><span class="muted">Aberto por ${escape(day.user)} · ${escape(day.notes)}</span></div><div class="actions"><span class="badge">Caixa aberto</span><button data-close-day class="secondary">Conferir e fechar caixa</button></div></div>${dashboard(state, day)}<div class="cards">${metric('Caixa inicial (fora do fundo)', day.initialCash)}${metric('Entradas físicas brutas', s.income)}${metric('Saídas físicas brutas (inclui troco)', s.expense)}${metric('Caixa esperado (fora do fundo)', s.cash)}</div><p class="help"><strong>Total físico esperado: ${brl(s.total)}</strong> = caixa ${brl(s.cash)} + fundo ${brl(s.fund)}. Vendas em espécie líquidas: ${brl(s.sales)}. Entradas e saídas brutas incluem recebimentos e troco; transferências ficam fora desses totais.</p>${fundPanel(day)}${dailyDetails(state, day)}<section class="panel"><h2>Movimentações avulsas de dinheiro</h2><p class="muted">Use Nova venda para registrar produtos. A venda em espécie avulsa é mantida para compatibilidade, sem classificar gás/água. Não lance a mesma venda nas duas opções.</p><div class="actions"><button data-move="sale">Venda em espécie</button><button data-move="replenish">Repor fundo</button><button data-move="income" class="secondary">Entrada</button><button data-move="expense" class="secondary">Saída</button><button data-move="transfer" class="secondary">Transferir</button><button data-move="adjustment" class="secondary">Ajustar</button></div></section><section class="panel"><div class="section-heading"><h2>Movimentações do expediente</h2><button id="close-day" class="secondary">Fechar caixa</button></div>${movementTable(day, true)}</section>`;
}
function renderHistory() {
  const filter = $('#history-date').value;
  const days = [...state.days].filter(day => !filter || day.date === filter).sort((a,b) => b.date.localeCompare(a.date));
  $('#history-list').innerHTML = days.length ? days.map(day => `<button class="history-item" data-history="${day.id}"><span>${dayDate(day.date)}<br><small>${escape(day.user)} · ${day.movements.length} lançamentos</small></span><span class="badge ${day.closing ? 'closed' : ''}">${day.closing ? 'Fechado' : 'Aberto'}</span></button>`).join('') : '<p>Nenhum caixa nesta data.</p>';
  const day = state.days.find(day => day.id === selectedHistory);
  $('#history-detail').innerHTML = day ? `<section class="panel"><h2>Abertura · ${dayDate(day.date)}</h2><p>Responsável: ${escape(day.user)} · ${time(day.createdAt)}</p><p>Caixa inicial: ${brl(day.initialCash)} · Fundo inicial: ${brl(day.initialFund)} · Total físico inicial: ${brl(day.initialCash + day.initialFund)}</p><p>Observações: ${escape(day.notes || 'Sem observações.')}</p></section>${closingPanel(day)}${fundPanel(day)}<section class="panel"><h2>Histórico completo de movimentações</h2>${movementTable(day)}</section>` : '';
}
function render() {
  renderCurrent(); renderHistory(); renderCommerce(state);
  const sync = syncStatus(state.days, state.business.events.length);
  $('#sync').textContent = `${sync.pending} registros locais pendentes de envio · serviço remoto não configurado`;
}
async function commit(transform) {
  if (busy) return false;
  busy = true; $('#submit').disabled = true;
  try {
    const next = transform(structuredClone(state));
    state = await save(next, state.revision);
    channel?.postMessage('changed');
    $('#message').hidden = true;
    render();
    return true;
  } catch (error) {
    try { state = await load(); render(); } catch { /* Preservar a causa inicial. */ }
    throw error;
  } finally { busy = false; $('#submit').disabled = false; }
}
function openModal(title, fields, action, submit = 'Confirmar e salvar') {
  $('#modal-title').textContent = title;
  $('#modal-fields').oninput = null; $('#modal-fields').onchange = null; $('#modal-fields').onclick = null;
  $('#modal-fields').innerHTML = fields;
  $('#modal-error').textContent = '';
  $('#submit').textContent = submit;
  dialogAction = action;
  dialogRevision = state.revision;
  $('#modal').showModal();
}
function activeDay(next) {
  const day = next.days.find(day => !day.closing);
  if (!day) throw new Error('O caixa foi fechado em outra operação. Atualize a tela.');
  return day;
}
function replaceDay(next, day) { next.days = next.days.map(item => item.id === day.id ? day : item); return next; }
function opening() {
  openModal('Abrir caixa', field('date', 'Data do expediente', 'date', today(), 'required') + '<p class="help">Informe somente o dinheiro fora do fundo no caixa inicial. O sistema somará os dois saldos. Referência do fundo: R$ 100,00.</p>' + amount('initialCash', 'Caixa inicial — fora do fundo (R$)') + amount('initialFund', 'Dinheiro disponível no fundo (R$)', '100,00') + userField() + notes(), async values => commit(next => {
    const day = openDay(next.days, { ...values, initialCash: money(values.initialCash), initialFund: money(values.initialFund) });
    next.days.push(day); return next;
  }));
}
function movement(type) {
  let fields = '';
  if (type === 'sale') fields = '<p class="help">O valor recebido entra no caixa. O troco sai do fundo. A venda e seu troco serão salvos juntos; não registre o troco novamente.</p>' + amount('amount', 'Valor da venda (R$)') + amount('received', 'Valor recebido do cliente (R$)') + '<p id="change-preview" class="help" aria-live="polite">Troco: informe os valores acima.</p>';
  else if (type === 'replenish') fields = '<p class="help">Do caixa para o fundo de troco. Não gera receita, venda ou despesa. Para aporte externo, use Entrada e selecione Fundo.</p>' + amount('amount', 'Valor a repor (R$)');
  else if (type === 'transfer') fields = selectAccount('from', 'Origem') + selectAccount('to', 'Destino') + amount('amount', 'Valor da transferência (R$)');
  else fields = selectAccount('account', type === 'income' ? 'Destino' : 'Conta') + (type === 'adjustment' ? '<p class="help">Ajuste altera o saldo esperado. Não use para esconder uma diferença: registre a justificativa. Também é possível registrar a diferença apenas no fechamento.</p><label>Direção<select name="direction"><option value="increase">Acrescentar ao saldo</option><option value="decrease">Reduzir o saldo</option></select></label>' : '') + amount('amount', 'Valor (R$)');
  const expectedDayId = state.days.find(day => !day.closing).id;
  openModal(TYPES[type], fields + description() + (type === 'expense' ? notes() : '') + userField(type === 'expense'), async values => commit(next => {
    const day = activeDay(next);
    if (day.id !== expectedDayId) throw new Error('O expediente mudou. Confira a tela e repita o lançamento.');
    return replaceDay(next, addMovement(day, { ...values, type, amount: money(values.amount), ...(type === 'sale' ? { received: money(values.received) } : {}) }));
  }));
  if (type === 'transfer') $('#modal-form [name="to"]').value = 'fund';
}
function closing() {
  const day = state.days.find(day => !day.closing);
  const expected = summary(day);
  openModal('Conferir e fechar caixa', `<p class="help">Esperado fora do fundo: <strong>${brl(expected.cash)}</strong>. Fundo esperado: <strong>${brl(expected.fund)}</strong>. Conte as duas partes separadamente. Após a confirmação, este caixa não aceitará novos lançamentos.</p>` + amount('countedCash', 'Caixa contado — fora do fundo (R$)') + amount('countedFund', 'Fundo de troco contado (R$)') + '<div id="closing-preview" class="help" aria-live="polite">Informe os valores contados para comparar.</div>' + userField() + notes('Observações (obrigatórias se houver diferença)'), async values => {
    const ok = await commit(next => {
      const current = activeDay(next);
      if (current.id !== day.id) throw new Error('O expediente mudou. Confira a tela.');
      const closed = closeDay(current, { ...values, countedCash: money(values.countedCash), countedFund: money(values.countedFund) });
      closed.closing.commerce = report(next, current.id);
      return replaceDay(next, closed);
    });
    if (ok) { selectedHistory = day.id; showTab('history'); renderHistory(); }
    return ok;
  }, 'Confirmar fechamento');
}
function reversal(id) {
  const day = state.days.find(day => !day.closing);
  const original = day.movements.find(m => m.id === id);
  openModal('Confirmar estorno', `<p class="help">${TYPES[original.type]} · ${escape(original.description)}. Os valores serão invertidos, preservando o lançamento original e a justificativa.</p>` + description() + userField(), async values => commit(next => {
    const current = activeDay(next);
    if (current.id !== day.id) throw new Error('O expediente mudou. Confira a tela.');
    return replaceDay(next, reverseMovement(current, id, values.description, values.user));
  }), 'Confirmar estorno');
}
function showTab(tab) {
  for (const name of ['current', 'sales', 'deliveries', 'receipts', 'history', 'settings']) {
    $(`#${name}`).hidden = name !== tab;
    const button = $(`#tab-${name}`);
    if (tab === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
}
$('#tab-current').onclick = () => showTab('current');
$('#tab-history').onclick = () => showTab('history');
for (const tab of ['sales','deliveries','receipts','settings']) $(`#tab-${tab}`).onclick = () => showTab(tab);
$('#history-date').oninput = renderHistory;
$('#cancel').onclick = $('#cancel-modal').onclick = () => { if (!busy) $('#modal').close(); };
$('#modal').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#modal-form').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    if (state.revision !== dialogRevision) throw new Error('Os dados mudaram em outra operação. Feche e reabra este formulário para conferir os saldos atuais.');
    if (await dialogAction(values)) { responsible = values.user; $('#modal').close(); }
  } catch (error) { $('#modal-error').textContent = error.message; }
};
$('#modal-form').addEventListener('input', () => {
  const values = Object.fromEntries(new FormData($('#modal-form')));
  if ($('#change-preview')) {
    try {
      const change = money(values.received) - money(values.amount);
      $('#change-preview').textContent = change < 0 ? 'O recebido não cobre a venda.' : `Troco entregue pelo fundo: ${brl(change)}`;
    } catch { $('#change-preview').textContent = 'Informe valores válidos para calcular o troco.'; }
  }
  if ($('#closing-preview')) {
    try {
      const expected = summary(state.days.find(day => !day.closing));
      const cashDiff = money(values.countedCash) - expected.cash;
      const fundDiff = money(values.countedFund) - expected.fund;
      $('#closing-preview').textContent = `Diferença no caixa: ${brl(cashDiff)}. Diferença no fundo: ${brl(fundDiff)}. Diferença total: ${brl(cashDiff + fundDiff)}.`;
    } catch { $('#closing-preview').textContent = 'Informe os dois valores contados para comparar.'; }
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !state) return;
  if (button.id === 'open-day') opening();
  if (button.id === 'close-day' || button.hasAttribute('data-close-day')) closing();
  if (button.dataset.move) movement(button.dataset.move);
  if (button.dataset.reverse) reversal(button.dataset.reverse);
  if (button.dataset.history) { selectedHistory = button.dataset.history; renderHistory(); }
  if (button.hasAttribute('data-print')) window.print();
});
$('#export').onclick = async () => {
  try {
    // Buscar a última revisão, inclusive quando outra aba realizou gravações.
    const latest = await load();
    const blob = new Blob([JSON.stringify({ app: 'liquigas-controle', exportedAt: new Date().toISOString(), ...latest }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `liquigas-copia-${today()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { showError(error); }
};
function connection() {
  $('#connection').textContent = navigator.onLine ? 'Conexão detectada' : 'Offline · modo local';
}
window.addEventListener('online', connection); window.addEventListener('offline', connection); connection();
if (channel) channel.onmessage = async () => {
  if (busy) return;
  try { state = await load(); render(); } catch (error) { showError(error); }
};
setupCommerce({ getState: () => state, commit, openModal, userField, field, amount, notes, escape, brl, time, showTab, showError });
try {
  state = await load(); render();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
} catch (error) { showError(new Error(`Não foi possível acessar o armazenamento local. Nenhuma operação foi salva. ${error.message}`)); }
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async () => {
    await navigator.serviceWorker.ready;
    $('#offline-ready').textContent = 'Aplicação disponível offline neste endereço';
  }).catch(() => { $('#offline-ready').textContent = 'Cache offline indisponível; mantenha esta página aberta.'; });
} else $('#offline-ready').textContent = 'Cache offline não suportado neste navegador.';
