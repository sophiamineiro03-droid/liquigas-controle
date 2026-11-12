import { money } from './domain.js';
import { PRODUCTS, METHODS, CATEGORIES, DELIVERY, DRIVERS, prepareState, report, balancesDue, createSale, editSale, updateSale, cancelSale, addReceipt, reverseReceipt, configureBenefit, recordSmallNotes } from './commerce.js';

let ui;
const $ = selector => document.querySelector(selector);
const esc = value => ui.escape(value);
const currency = value => ui.brl(value);
const inputMoney = value => (value / 100).toFixed(2).replace('.', ',');
const options = (values, selected) => Object.entries(values).map(([key, label]) => `<option value="${esc(key)}" ${key === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
const select = (name, title, values, selected) => `<label>${title}<select name="${name}" aria-label="${esc(title)}">${options(values, selected)}</select></label>`;
const metric = (title, value) => `<div class="metric"><span>${title}</span><strong>${currency(value)}</strong></div>`;
const AUDIT = { saleCreated: 'Cadastro da venda', saleEdited: 'Correção da venda', saleUpdated: 'Entrega / observações / RevGás atualizados', saleCanceled: 'Cancelamento e estorno', receiptCreated: 'Recebimento registrado', receiptReversed: 'Estorno do recebimento' };
const qty = value => new Intl.NumberFormat('pt-BR').format(value);
const state = () => prepareState(ui.getState());
const active = () => state().days.find(day => !day.closing);
function operationalButton(action, text) { return `<button ${action}>${text}</button>`; }

export function financialReport(data, title = 'Financeiro por categoria') {
  return `<section class="panel"><h2>${title}</h2><p class="muted">Recebimentos incluem dívidas pagas no expediente. Entradas avulsas e ajustes ficam apenas no caixa físico, fora desta classificação. Benefício, Pix e cartões não são dinheiro da gaveta.</p><div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Gás</th><th>Água</th><th>Total</th></tr></thead><tbody>${[
    ['Vendas de produtos', c => c.products], ['Taxas de entrega faturadas', c => c.feeBilled], ['Total vendido (inclui taxas)', c => c.sold],
    ...Object.entries(METHODS).filter(([key]) => key !== 'creditSale').map(([key, name]) => [name + ' recebido', c => c.payments[key]]),
    ['Fiado / pendente na venda', c => c.creditSold], ['Total efetivamente recebido', c => c.received],
  ].map(([label, getter]) => `<tr><td>${label}</td><td class="amount">${currency(getter(data.categories.gas))}</td><td class="amount">${currency(getter(data.categories.water))}</td><td class="amount">${currency(getter(data.categories.gas) + getter(data.categories.water))}</td></tr>`).join('')}</tbody></table></div><h3>Taxas de entrega e recebimentos de dívidas</h3><div class="table-wrap"><table><thead><tr><th>Pagamento</th><th>Taxas recebidas (gás)</th><th>Dívidas de gás</th><th>Dívidas de água</th></tr></thead><tbody>${['cash', 'pix', 'debit', 'credit'].map(key => `<tr><td>${METHODS[key]}</td><td>${currency(data.categories.gas.fees[key])}</td><td>${currency(data.categories.gas.debtPayments[key])}</td><td>${currency(data.categories.water.debtPayments[key])}</td></tr>`).join('')}</tbody></table></div><p class="muted">As discriminações acima já fazem parte dos recebimentos; não some novamente. Gás do Povo no RevGás: lançar como débito. Débito + benefício: ${currency(data.payments.debit + data.payments.benefit)}.</p></section>`;
}
export function dashboard(currentState, day) {
  const data = report(currentState, day.id);
  return `<section class="panel daily-overview"><div class="section-heading"><div><span class="eyebrow">OPERAÇÕES DO EXPEDIENTE</span><h2>Gás e água, no mesmo painel</h2></div><div class="actions"><button data-new-sale>Nova venda</button><button data-new-receipt class="secondary">Novo recebimento</button></div></div><div class="cards">${metric('Total vendido em gás (inclui taxas)', data.categories.gas.sold)}${metric('Total vendido em água', data.categories.water.sold)}${metric('Dinheiro recebido (líquido de troco)', data.payments.cash)}${metric('Pix recebido', data.payments.pix)}${metric('Cartão de débito', data.payments.debit)}${metric('Cartão de crédito', data.payments.credit)}${metric('Gás do Povo', data.payments.benefit)}${metric('Fiado / pendente na venda', data.creditSold)}${metric('Recebimentos de dívidas', data.debtReceived)}${metric('Saídas operacionais', data.expense)}${metric('Recebíveis conhecidos em aberto', data.pending)}${metric('Total recebido (todos os meios)', data.received)}</div><div class="operational-counts"><button data-go="deliveries" class="secondary">${data.deliveryQueue} pedidos aguardando entrega/retirada (todos os dias)</button><button data-go="sales" class="secondary">${data.revGasQueue} vendas pendentes no RevGás (todos os dias)</button><span>${data.benefitQuantity} P13 pelo Gás do Povo</span></div><p class="muted">Recebido de dívidas de dias anteriores ou sem vínculo: ${currency(data.previousDebtReceived)}. Pendente das vendas deste expediente: ${currency(data.pendingToday)}. Dívidas antigas sem valor original informado não entram no saldo pendente conhecido.</p>${data.legacySales ? `<p class="notice">Há ${currency(data.legacySales)} de vendas avulsas antigas, sem produto ou categoria. Permanecem no caixa físico, fora dos totais de gás/água. Não recadastre como nova venda.</p>` : ''}</section>`;
}
export function dailyDetails(currentState, day) {
  const data = report(currentState, day.id);
  return `<section class="panel"><h2>Quantidades por produto</h2><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Vendido</th><th>Entregue / retirado</th><th>Pendente</th></tr></thead><tbody>${Object.entries(PRODUCTS).map(([key, product]) => `<tr><td>${product.name}</td><td>${qty(data.quantities[key].sold)}</td><td>${qty(data.quantities[key].delivered)}</td><td>${qty(data.quantities[key].pending)}</td></tr>`).join('')}</tbody></table></div><p class="muted">Controle de quantidades das vendas, sem movimentação de estoque.</p></section><details class="panel"><summary>Ver resumo financeiro por gás, água e forma de pagamento</summary>${financialReport(data)}</details><section class="panel"><h2>Vendas do expediente · ordem de registro</h2>${saleList(currentState, currentState.business.sales.filter(s => s.dayId === day.id))}</section><section class="panel"><div class="section-heading"><h2>Saídas do Caixa</h2><button data-move="expense" class="secondary">Nova saída</button></div>${data.expenses.length ? data.expenses.map(m => `<div class="expense-line"><strong>${currency(m.entries.reduce((sum,e) => sum+e.amount,0))}</strong> · ${esc(m.description)}<small>${ui.time(m.createdAt)} · ${esc(m.user)} · ${esc(m.notes ?? '')}</small><button data-reverse="${m.id}" class="secondary">Estornar saída</button></div>`).join('') : '<p class="muted">Nenhuma saída operacional ativa. Troco e transferências internas não são despesas.</p>'}</section>`;
}

function auditSnapshot(value) {
  if (!value) return '<p>Sem registro anterior.</p>';
  if (value.items) return `<p>Cliente: ${esc(value.customer)}</p><p>${value.items.map(i => `${i.quantity} × ${PRODUCTS[i.product].name}: ${currency(i.total)}`).join(' · ')}</p><p>${value.payments.map(p => `${CATEGORIES[p.category]} / ${METHODS[p.method]}: ${currency(p.amount)}`).join(' · ')}</p><p>Taxa: ${currency(value.fee?.amount ?? 0)} ${value.fee ? `(${METHODS[value.fee.method]}, ${value.fee.status === 'paid' ? 'paga' : 'pendente na origem'})` : ''} · Troco: ${currency(value.change)}</p><p>Entrega: ${DELIVERY[value.delivery.status]} · ${esc(value.delivery.driver === 'Outro' ? value.delivery.driverOther : value.delivery.driver)} · RevGás: ${value.posted ? 'lançada' : 'pendente'}</p><p>Observações: ${esc(value.notes || 'Sem observações.')}<br>Endereço: ${Object.values(value.address).map(esc).filter(Boolean).join(' · ') || 'Não informado.'}</p>`;
  return '<p>Registro preservado na cópia exportada.</p>';
}

function saleList(currentState, sales) {
  if (!sales.length) return '<p class="muted">Nenhuma venda para estes filtros.</p>';
  return sales.map(sale => {
    const due = balancesDue(currentState, sale);
    const totalDue = Object.values(due).reduce((a,b) => a+b, 0);
    const day = currentState.days.find(d => d.id === sale.dayId);
    const changes = currentState.business.events.filter(event => event.entityId === sale.id);
    return `<article class="sale-card ${sale.canceled ? 'canceled-sale' : ''}"><div class="section-heading"><div><strong>${esc(sale.customer)}</strong><small>${ui.time(sale.createdAt)} · ${esc(sale.user)}</small></div><span class="badge ${sale.canceled ? 'closed' : ''}">${sale.canceled ? 'Cancelada / estornada' : DELIVERY[sale.delivery.status]}</span></div><div class="sale-products">${sale.items.map(item => `<span>${qty(item.quantity)} × ${PRODUCTS[item.product].name} <strong>${currency(item.total)}</strong>${item.benefit ? ' · Gás do Povo' : ''}</span>`).join('')}</div><p>${sale.payments.map(p => `${CATEGORIES[p.category]} · ${METHODS[p.method]}: ${currency(p.amount)}`).join(' / ')}${sale.fee ? `<br>Taxa de entrega: ${currency(sale.fee.amount)} · ${METHODS[sale.fee.method]} · ${sale.fee.status === 'paid' ? 'Paga' : due.fee ? `Pendente: ${currency(due.fee)}` : 'Quitada por recebimentos'}` : ''}</p><p>Entrega: ${esc(sale.delivery.driver === 'Outro' ? sale.delivery.driverOther : sale.delivery.driver)} · RevGás: <strong>${sale.posted ? 'Lançada' : 'Pendente'}</strong> · A receber: <strong>${currency(totalDue)}</strong></p>${sale.notes ? `<p class="sale-note">${esc(sale.notes)}</p>` : ''}<details><summary>Endereço, troco e trilha de alterações</summary><p>${Object.values(sale.address).map(esc).filter(Boolean).join(' · ') || 'Endereço não informado.'}</p><p>Recebido em espécie: ${currency(sale.tendered)} · Troco: ${currency(sale.change)} (${sale.changeFrom === 'fund' ? 'fundo' : 'caixa'}).</p><p class="muted">ID: ${sale.id}</p>${changes.map(event => `<div class="audit-entry"><strong>${esc(AUDIT[event.type] ?? 'Atualização')}</strong> · ${ui.time(event.createdAt)} · ${esc(event.user)}<p>${esc(event.reason)}</p><details><summary>Dados anteriores e posteriores</summary><h4>Antes</h4>${auditSnapshot(event.before)}<h4>Depois</h4>${auditSnapshot(event.after)}</details></div>`).join('')}</details>${!sale.canceled ? `<div class="actions sale-actions"><button class="secondary" data-update-sale="${sale.id}">Atualizar entrega / observações / RevGás</button>${!day.closing ? `<button class="secondary" data-edit-sale="${sale.id}">Corrigir venda</button><button class="secondary" data-cancel-sale="${sale.id}">Cancelar e estornar</button>` : ''}${totalDue ? `<button class="secondary" data-receive-sale="${sale.id}">Receber dívida</button>` : ''}</div>` : ''}</article>`;
  }).join('');
}
export function renderCommerce(currentState) {
  if (!ui || !currentState) return;
  currentState = prepareState(currentState);
  const saleDate = $('#sales-date').value, unposted = $('#sales-unposted').checked;
  $('#sales-list').innerHTML = saleList(currentState, currentState.business.sales.filter(s => (!saleDate || currentState.days.find(d => d.id === s.dayId)?.date === saleDate) && (!unposted || (!s.posted && !s.canceled))));
  const driver = $('#delivery-driver').value, status = $('#delivery-status').value;
  $('#deliveries-list').innerHTML = saleList(currentState, currentState.business.sales.filter(s => (!driver || s.delivery.driver === driver) && (!status || (status === 'pending' ? !['delivered','collected','canceled'].includes(s.delivery.status) : s.delivery.status === status))));
  $('#receipts-list').innerHTML = currentState.business.receipts.length ? currentState.business.receipts.map(r => {
    const original = currentState.business.sales.find(s => s.id === r.saleId);
    const due = original ? balancesDue(currentState, original) : null;
    const closed = currentState.days.find(d => d.id === r.dayId)?.closing;
    return `<article class="sale-card"><div class="section-heading"><strong>${esc(r.customer)} · ${currency(r.amount)}</strong><span class="badge ${r.reversed ? 'closed' : ''}">${r.reversed ? 'Estornado' : METHODS[r.method]}</span></div><p>${CATEGORIES[r.category]} · ${ui.time(r.createdAt)} · ${esc(r.user)}</p><p>${esc(r.notes)}</p><p>${original ? `Venda vinculada: ${original.id}. Restante conhecido: ${currency(Object.values(due).reduce((a,b) => a+b,0))}.` : 'Sem venda original vinculada. Saldo anterior e restante desconhecidos; registro apenas do valor recebido.'}</p><details><summary>Histórico deste recebimento</summary>${currentState.business.events.filter(e => e.entityId === r.id).map(e => `<p>${esc(AUDIT[e.type] ?? 'Atualização')} · ${ui.time(e.createdAt)} · ${esc(e.user)}<br>${esc(e.reason)}</p>`).join('')}</details>${!closed && !r.reversed ? `<button class="secondary" data-reverse-receipt="${r.id}">Estornar recebimento</button>` : ''}</article>`;
  }).join('') : '<section class="panel"><p>Nenhum recebimento registrado.</p></section>';
  $('#settings-content').innerHTML = `<section class="panel"><h2>Gás do Povo</h2><p>Valor por P13 para novas vendas: <strong>${currency(currentState.business.benefitPrice)}</strong>.</p><p>No RevGás, lançar o benefício como cartão de débito. O valor vai para a conta de Seu Chicó e não entra na gaveta. Taxas são registradas separadamente.</p><button id="benefit-config">Alterar valor padrão</button></section><section class="panel"><h2>Operação local</h2><p>Sem banco remoto, autenticação externa ou sincronização. O sistema é auxiliar ao RevGás; a marcação “Lançada” é manual, não uma integração.</p></section>`;
}
function deliveryFields(sale) {
  const value = sale?.delivery ?? { driver: 'Depósito', driverOther: '', status: 'pickup' };
  return '<h3>Entrega / retirada</h3><div class="grid-two">' + select('driver', 'Responsável pela entrega / retirada', Object.fromEntries(DRIVERS.map(x => [x,x])), value.driver) + select('deliveryStatus', 'Situação da entrega', Object.fromEntries(Object.entries(DELIVERY).filter(([key]) => key !== 'canceled')), value.status) + '</div>' + ui.field('driverOther', 'Nome de outro entregador (se selecionado Outro)', 'text', value.driverOther, 'maxlength="100"');
}
function itemRow(item = { product: 'p13', quantity: 1, total: '' }) {
  return `<div class="item-row">${select('product', 'Produto', Object.fromEntries(Object.entries(PRODUCTS).map(([k,p]) => [k,p.name])), item.product)}${ui.field('quantity', 'Quantidade', 'number', item.quantity, 'required min="1" max="99999" step="1"')}${ui.amount('itemTotal', 'Valor total destes produtos (R$)', typeof item.total === 'number' ? inputMoney(item.total) : '')}<label class="check item-benefit"><input type="checkbox" name="benefitItem" ${item.benefit ? 'checked' : ''}> P13 pelo benefício</label><button type="button" class="secondary remove-row">Remover produto</button></div>`;
}
function paymentRow(payment = { category: 'gas', method: 'cash', amount: '' }) {
  return `<div class="payment-row">${select('category', 'Categoria do pagamento', CATEGORIES, payment.category)}${select('method', 'Forma de pagamento dos produtos', Object.fromEntries(Object.entries(METHODS).filter(([key]) => key !== 'benefit')), payment.method)}${ui.amount('paymentAmount', 'Valor deste pagamento (R$)', typeof payment.amount === 'number' ? inputMoney(payment.amount) : '')}<button type="button" class="secondary remove-row">Remover pagamento</button></div>`;
}
function parseItems() {
  return [...document.querySelectorAll('.item-row')].map(row => ({ product: row.querySelector('[name=product]').value, quantity: Number(row.querySelector('[name=quantity]').value), total: money(row.querySelector('[name=itemTotal]').value), benefit: $('#benefit-mode').checked && row.querySelector('[name=benefitItem]').checked }));
}
function parseSale(values, old) {
  const items = parseItems();
  const benefit = $('#benefit-mode').checked;
  const benefitTotal = items.filter(i => i.benefit).reduce((sum,i) => sum+i.total,0);
  if (benefit && !benefitTotal) throw new Error('Marque pelo menos um P13 pago pelo Gás do Povo, ou desmarque a opção do benefício.');
  const payments = items.some(i => !i.benefit) ? [...document.querySelectorAll('.payment-row')].map(row => ({ category: row.querySelector('[name=category]').value, method: row.querySelector('[name=method]').value, amount: money(row.querySelector('[name=paymentAmount]').value) })) : [];
  if (benefitTotal) payments.push({ category: 'gas', method: 'benefit', amount: benefitTotal });
  const fee = $('#has-fee').checked ? { amount: money(values.feeAmount), method: values.feeMethod, status: values.feeStatus } : null;
  return { customer: values.customer, items, payments, fee, benefitPrice: old?.benefitPrice ?? state().business.benefitPrice, tendered: values.tendered ? money(values.tendered) : undefined, changeFrom: values.changeFrom,
    delivery: { driver: values.driver, driverOther: values.driverOther, status: values.deliveryStatus }, notes: values.notes,
    address: Object.fromEntries(['district','street','number','extra','reference'].map(key => [key, values[key]])), posted: values.posted === 'yes' };
}
function saleForm(saleId) {
  if (!active()) throw new Error('Abra um caixa para cadastrar uma venda.');
  const sale = state().business.sales.find(s => s.id === saleId);
  const price = sale?.benefitPrice ?? state().business.benefitPrice;
  const isBenefit = sale?.payments.some(p => p.method === 'benefit');
  const fields = ui.field('customer', 'Nome do cliente', 'text', sale?.customer ?? '', 'required maxlength="100"') +
    `<label class="check"><input id="benefit-mode" type="checkbox" ${isBenefit ? 'checked' : ''}> Pagamento pelo Gás do Povo</label><p class="muted">Benefício: ${currency(price)} por P13. Marque os P13 pelo benefício em cada linha. O valor deles é automático; outros produtos e pagamentos podem ficar na mesma venda.</p><h3>Produtos</h3><div id="item-rows">${(sale?.items ?? [{}]).map(i => itemRow(i.product ? { ...i, benefit: i.benefit ?? (isBenefit && i.product === 'p13') } : undefined)).join('')}</div><button type="button" id="add-item" class="secondary">Adicionar produto</button><p id="sale-totals" class="help" aria-live="polite"></p><div id="normal-payments"><h3>Pagamentos dos produtos</h3><p class="muted">Discrimine o valor de cada categoria. Inclua a parte fiada para completar o total. A taxa de entrega fica no campo próprio.</p><div id="payment-rows">${(sale?.payments.filter(p => p.method !== 'benefit')?.length ? sale.payments.filter(p => p.method !== 'benefit') : [{}]).map(p => paymentRow(p.method ? p : undefined)).join('')}</div><button type="button" id="add-payment" class="secondary">Dividir / adicionar pagamento</button></div>` +
    `<div id="benefit-fee"><label class="check"><input type="checkbox" id="has-fee" ${sale?.fee ? 'checked' : ''}> Haverá entrega com taxa?</label><div id="fee-fields">${ui.amount('feeAmount', 'Taxa de entrega (R$)', sale?.fee ? inputMoney(sale.fee.amount) : '')}<div class="grid-two">${select('feeMethod', 'Forma de pagamento da taxa', Object.fromEntries(Object.entries(METHODS).filter(([key]) => key !== 'benefit')), sale?.fee?.method ?? 'cash')}${select('feeStatus', 'Situação do pagamento da taxa', { paid: 'Paga', pending: 'Pendente / não recebida' }, sale?.fee?.status ?? 'paid')}</div></div></div>` +
    ui.field('tendered', 'Dinheiro entregue pelo cliente (opcional; vazio = valor exato)', 'text', sale?.tendered ? inputMoney(sale.tendered) : '', 'inputmode="decimal" maxlength="13"') + select('changeFrom', 'De onde saiu o troco?', { fund: 'Fundo de troco', cash: 'Caixa das vendas' }, sale?.changeFrom ?? 'fund') + '<p id="order-change" class="help" aria-live="polite"></p>' + deliveryFields(sale) +
    `<details><summary>Endereço (opcional)</summary>${[['district','Bairro'],['street','Rua'],['number','Número'],['extra','Complemento'],['reference','Referência']].map(([key,label]) => ui.field(key,label,'text',sale?.address[key] ?? '', 'maxlength="200"')).join('')}</details>` +
    `<label>Observações da venda<textarea name="notes" maxlength="500" rows="2">${esc(sale?.notes ?? '')}</textarea></label>` + select('posted', 'Lançamento no RevGás', { no: 'Ainda não lançada', yes: 'Já lançada' }, sale?.posted ? 'yes' : 'no') +
    (sale ? ui.field('reason', 'Justificativa da correção', 'text', '', 'required maxlength="500"') : '') + ui.userField();
  ui.openModal(sale ? 'Corrigir venda' : 'Nova venda', fields, async values => ui.commit(next => {
    const input = parseSale(values, sale);
    return sale ? editSale(next, sale.id, input, values.reason, values.user) : createSale(next, input, values.user);
  }));
  function recalculate(event) {
    const benefit = $('#benefit-mode').checked;
    for (const row of document.querySelectorAll('.item-row')) {
      const product = row.querySelector('[name=product]').value;
      const flag = row.querySelector('[name=benefitItem]');
      row.querySelector('.item-benefit').hidden = !benefit || product !== 'p13';
      if (!benefit || product !== 'p13') flag.checked = false;
      else if (event?.target?.id === 'benefit-mode' || event?.target === row.querySelector('[name=product]')) flag.checked = true;
    }
    const normal = [...document.querySelectorAll('.item-row')].some(row => !row.querySelector('[name=benefitItem]').checked);
    $('#normal-payments').hidden = !normal;
    $('#normal-payments').querySelectorAll('input,select').forEach(input => { input.disabled = !normal; });
    $('#benefit-fee').hidden = !benefit;
    const hasFee = benefit && $('#has-fee').checked;
    $('#fee-fields').hidden = !hasFee;
    $('#fee-fields').querySelectorAll('input,select').forEach(input => { input.disabled = !hasFee; });
    if (!benefit) $('#has-fee').checked = false;
    document.querySelectorAll('.item-row').forEach(row => {
      const flag = row.querySelector('[name=benefitItem]').checked;
      if (flag) {
        const amount = Number(row.querySelector('[name=quantity]').value) * price;
        row.querySelector('[name=itemTotal]').value = Number.isSafeInteger(amount) && amount >= 0 ? inputMoney(amount) : '';
      }
      row.querySelector('[name=itemTotal]').readOnly = flag;
    });
    try {
      const items = parseItems();
      const gas = items.filter(i => PRODUCTS[i.product].category === 'gas').reduce((s,i) => s+i.total,0);
      const water = items.filter(i => PRODUCTS[i.product].category === 'water').reduce((s,i) => s+i.total,0);
      $('#sale-totals').textContent = `Produtos: gás ${currency(gas)} · água ${currency(water)} · total ${currency(gas+water)}.`;
      let cash = 0;
      if (normal) document.querySelectorAll('.payment-row').forEach(row => { if (row.querySelector('[name=method]').value === 'cash') cash += money(row.querySelector('[name=paymentAmount]').value); });
      if (hasFee && $('[name=feeStatus]').value === 'paid' && $('[name=feeMethod]').value === 'cash') cash += money($('[name=feeAmount]').value);
      const tendered = $('[name=tendered]').value ? money($('[name=tendered]').value) : cash;
      $('#order-change').textContent = !cash && tendered ? 'Não há parcela em dinheiro. Limpe o campo de dinheiro entregue.' : `Parcela em dinheiro: ${currency(cash)} · Troco: ${currency(tendered-cash)}. Recebimento e troco serão gravados juntos.`;
    } catch { $('#sale-totals').textContent = 'Preencha os valores dos produtos e os pagamentos para conferir.'; $('#order-change').textContent = 'O troco é calculado sobre a parcela paga em dinheiro, incluindo taxa paga em espécie.'; }
  }
  $('#add-item').onclick = () => { if ($$('.item-row') >= 30) return; $('#item-rows').insertAdjacentHTML('beforeend', itemRow()); $('#item-rows').lastElementChild.querySelector('[name=benefitItem]').checked = $('#benefit-mode').checked; recalculate(); };
  $('#add-payment').onclick = () => { if ($$('.payment-row') >= 30) return; $('#payment-rows').insertAdjacentHTML('beforeend', paymentRow()); recalculate(); };
  const form = $('#modal-fields');
  form.onclick = event => { if (event.target.classList.contains('remove-row')) { event.target.closest('.item-row,.payment-row').remove(); recalculate(); } };
  form.oninput = form.onchange = recalculate;
  recalculate();
}
const $$ = selector => document.querySelectorAll(selector).length;
function receiptForm(saleId = '') {
  if (!active()) throw new Error('Abra um caixa para registrar recebimentos.');
  const sales = state().business.sales.filter(s => !s.canceled && Object.values(balancesDue(state(), s)).some(amount => amount > 0));
  const saleOptions = { '': 'Sem venda original — saldo anterior desconhecido', ...Object.fromEntries(sales.map(s => [s.id, `${s.customer} · ${currency(Object.values(balancesDue(state(),s)).reduce((a,b) => a+b,0))} · ${s.id.slice(0,8)}`])) };
  ui.openModal('Novo recebimento', select('saleId', 'Venda original (quando disponível)', saleOptions, saleId) + '<div id="receipt-target"></div>' + ui.amount('receiptAmount', 'Valor efetivamente recebido (R$)') + select('receiptMethod', 'Forma de pagamento do recebimento', Object.fromEntries(Object.entries(METHODS).filter(([key]) => !['benefit','creditSale'].includes(key))), 'cash') + ui.notes() + ui.userField(), async values => ui.commit(next => addReceipt(next, { saleId: values.saleId || null, target: values.target, category: values.receiptCategory, customer: values.receiptCustomer, amount: money(values.receiptAmount), method: values.receiptMethod, notes: values.notes }, values.user)));
  function target() {
    const sale = sales.find(s => s.id === $('[name=saleId]').value);
    $('#receipt-target').innerHTML = sale ? select('target', 'Parte da dívida a receber', Object.fromEntries(Object.entries(balancesDue(state(),sale)).filter(([,amount]) => amount>0).map(([key,amount]) => [key, `${key === 'fee' ? 'Taxa de entrega' : CATEGORIES[key]} · falta ${currency(amount)}`])), Object.keys(balancesDue(state(),sale)).find(key => balancesDue(state(),sale)[key]>0)) : ui.field('receiptCustomer', 'Nome do cliente', 'text', '', 'required maxlength="100"') + select('receiptCategory', 'Categoria do recebimento antigo', CATEGORIES, 'gas') + '<p class="help">Será registrado somente o recebido. Saldo anterior e restante desconhecidos; não conta como venda nova.</p>';
  }
  $('[name=saleId]').onchange = target; target();
}
function metadataForm(saleId) {
  const sale = state().business.sales.find(s => s.id === saleId);
  ui.openModal('Atualizar venda sem alterar valores', deliveryFields(sale) + `<label>Observações da venda<textarea name="notes" maxlength="500">${esc(sale.notes)}</textarea></label>` + select('posted', 'Lançamento no RevGás', { no: 'Ainda não lançada', yes: 'Já lançada' }, sale.posted ? 'yes' : 'no') + ui.field('reason', 'Motivo da atualização', 'text', '', 'required maxlength="500"') + ui.userField(), async values => ui.commit(next => updateSale(next, saleId, { delivery: { driver: values.driver, driverOther: values.driverOther, status: values.deliveryStatus }, posted: values.posted === 'yes', notes: values.notes }, values.reason, values.user)));
}
function reverseForm(entityId, receipt = false) {
  ui.openModal(receipt ? 'Estornar recebimento' : 'Cancelar e estornar venda', '<p class="help">A operação ficará preservada e seus efeitos financeiros serão invertidos. Confirme apenas se a entrada deve ser anulada/devolvida. Transferências e fechamento não serão apagados.</p>' + ui.field('reason', 'Justificativa do estorno', 'text', '', 'required maxlength="500"') + ui.userField(), async values => ui.commit(next => receipt ? reverseReceipt(next, entityId, values.reason, values.user) : cancelSale(next, entityId, values.reason, values.user)), 'Confirmar estorno');
}
export function setupCommerce(helpers) {
  ui = helpers;
  for (const selector of ['#sales-date','#sales-unposted','#delivery-driver','#delivery-status']) $(selector).addEventListener('change', () => renderCommerce(state()));
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || !ui.getState()) return;
    try {
      if (button.hasAttribute('data-new-sale')) saleForm();
      if (button.hasAttribute('data-new-receipt')) receiptForm();
      if (button.dataset.receiveSale) receiptForm(button.dataset.receiveSale);
      if (button.dataset.editSale) saleForm(button.dataset.editSale);
      if (button.dataset.updateSale) metadataForm(button.dataset.updateSale);
      if (button.dataset.cancelSale) reverseForm(button.dataset.cancelSale);
      if (button.dataset.reverseReceipt) reverseForm(button.dataset.reverseReceipt, true);
      if (button.dataset.go) {
        if (button.dataset.go === 'sales') { $('#sales-unposted').checked = true; $('#sales-date').value = ''; }
        if (button.dataset.go === 'deliveries') { $('#delivery-driver').value = ''; $('#delivery-status').value = 'pending'; }
        renderCommerce(state()); ui.showTab(button.dataset.go);
      }
      if (button.id === 'benefit-config') ui.openModal('Valor padrão do Gás do Povo', ui.amount('price','Valor por P13 (R$)', inputMoney(state().business.benefitPrice)) + '<p class="help">Vendas já registradas mantêm seus valores. A alteração vale apenas para novas vendas.</p>' + ui.userField(), async values => ui.commit(next => configureBenefit(next, money(values.price), values.user)));
      if (button.id === 'small-notes') ui.openModal('Notas pequenas e moedas', select('needed','Situação das notas pequenas', { yes: 'Faltam notas pequenas / moedas', no: 'Notas e moedas suficientes' }, active().smallNotesNeeded ? 'yes' : 'no') + ui.field('reason','Observação da conferência de notas','text','','required maxlength="500"') + '<p class="help">Trocar uma nota por outras do mesmo valor não altera o saldo.</p>' + ui.userField(), async values => ui.commit(next => recordSmallNotes(next, values.needed === 'yes', values.reason, values.user)));
    } catch (error) { ui.showError(error); }
  });
}
