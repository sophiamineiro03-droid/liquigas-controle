import { money } from './domain.js';
import { PRODUCTS, METHODS, CATEGORIES, DELIVERY, DRIVERS, createSale, editSale } from './commerce.js';

const $ = selector => document.querySelector(selector);
const rows = selector => [...document.querySelectorAll(selector)];
const NORMAL_METHODS = Object.fromEntries(Object.entries(METHODS).filter(([key]) => key !== 'benefit'));

export function openSaleForm(ui, saleId) {
  if (!ui.active()) throw new Error('Abra um caixa para cadastrar uma venda.');
  const sale = ui.state().business.sales.find(item => item.id === saleId);
  const price = sale?.benefitPrice ?? ui.state().business.benefitPrice;
  const normalPayments = sale?.payments.filter(p => p.method !== 'benefit') ?? [];
  const isBenefit = sale?.payments.some(p => p.method === 'benefit') ?? false;
  const splitInitially = normalPayments.length > 1;
  let splitInitialized = splitInitially;
  const { esc, currency, inputMoney, select } = ui;
  function itemRow(item = { product: 'p13', quantity: 1, total: '' }) {
    return `<div class="item-row">${select('product', 'Produto', Object.fromEntries(Object.entries(PRODUCTS).map(([key,p]) => [key,p.name])), item.product)}${ui.field('quantity','Quantidade','number',item.quantity,'required min="1" max="99999" step="1"')}${ui.amount('itemTotal','Total da linha (R$)',typeof item.total === 'number' ? inputMoney(item.total) : '')}<label class="check item-benefit"><input type="checkbox" name="benefitItem" ${item.benefit ? 'checked' : ''}> Este P13 é pelo benefício</label><button type="button" class="secondary remove-row">Remover produto</button></div>`;
  }
  function paymentRow(payment = { category: 'gas', method: 'cash', amount: '' }) {
    return `<div class="payment-row">${select('category','Categoria',CATEGORIES,payment.category)}${select('method','Forma',NORMAL_METHODS,payment.method)}${ui.amount('paymentAmount','Valor (R$)',typeof payment.amount === 'number' ? inputMoney(payment.amount) : '')}<button type="button" class="secondary remove-row">Remover pagamento</button></div>`;
  }
  const delivery = sale?.delivery ?? { driver: 'Depósito', driverOther: '', status: 'pickup' };
  const hasAddress = sale && Object.values(sale.address).some(Boolean);
  const fields = `<div class="sale-form-intro">${ui.field('customer','Nome do cliente','text',sale?.customer ?? '', 'required maxlength="100" autocomplete="off"')}</div><h3>Produtos</h3><div id="item-rows">${(sale?.items ?? [{}]).map(item => itemRow(item.product ? { ...item, benefit: item.benefit ?? (isBenefit && item.product === 'p13') } : undefined)).join('')}</div><button type="button" id="add-item" class="secondary">Adicionar produto</button><div id="sale-totals" class="sale-total" aria-live="polite">Informe o total da linha para calcular a venda.</div><h3>Pagamento</h3><label class="check"><input id="benefit-mode" type="checkbox" ${isBenefit ? 'checked' : ''}> Gás do Povo</label><p id="benefit-help" class="muted" hidden>P13 pelo benefício: ${currency(price)} por unidade, calculado automaticamente. Se apenas parte dos P13 usar o benefício, separe em linhas.</p><div id="normal-payments">${select('simpleMethod','Forma de pagamento',NORMAL_METHODS,normalPayments[0]?.method ?? 'cash')}<label class="check"><input type="checkbox" id="split-payment" ${splitInitially ? 'checked' : ''}> Dividir pagamento</label><div id="split-fields" hidden><p class="muted">Informe cada parte. Em vendas mistas, selecione gás ou água; o sistema não divide os valores por conta própria.</p><div id="payment-rows">${(splitInitially ? normalPayments : []).map(paymentRow).join('')}</div><button type="button" id="add-payment" class="secondary">Adicionar outra forma</button><p id="allocation-summary" class="help" aria-live="polite"></p></div><p id="payment-summary" class="muted" aria-live="polite"></p></div><div id="benefit-fee" hidden><label class="check"><input type="checkbox" id="has-fee" ${sale?.fee ? 'checked' : ''}> Cobrar taxa de entrega</label><div id="fee-fields">${ui.amount('feeAmount','Taxa de entrega (R$)',sale?.fee ? inputMoney(sale.fee.amount) : '')}<div class="grid-two">${select('feeMethod','Pagamento da taxa',NORMAL_METHODS,sale?.fee?.method ?? 'cash')}${select('feeStatus','Situação da taxa',{paid:'Paga',pending:'Pendente'},sale?.fee?.status ?? 'paid')}</div></div></div><div id="cash-fields">${ui.field('tendered','Cliente entregou em dinheiro (R$)','text',sale?.tendered ? inputMoney(sale.tendered) : '', 'inputmode="decimal" maxlength="13" placeholder="Vazio = valor exato"')}<p id="order-change" class="help" aria-live="polite"></p><div id="change-account">${select('changeFrom','Retirar troco de',{fund:'Fundo de troco',cash:'Caixa das vendas'},sale?.changeFrom ?? 'fund')}</div></div><h3>Entrega ou retirada</h3><div class="grid-two">${select('driver','Quem entrega / retirada no local',Object.fromEntries(DRIVERS.map(driver => [driver,driver === 'Depósito' ? 'Depósito — retirada no local' : driver])),delivery.driver)}${select('deliveryStatus','Situação',Object.fromEntries(Object.entries(DELIVERY).filter(([key]) => key !== 'canceled')),delivery.status)}</div><div id="other-driver">${ui.field('driverOther','Nome do entregador','text',delivery.driverOther,'maxlength="100"')}</div><details id="sale-extras"><summary>Observações e endereço${sale?.notes || hasAddress ? ' · preenchidos' : ' (opcional)'}</summary><label>Observações da venda<textarea name="notes" maxlength="500" rows="2">${esc(sale?.notes ?? '')}</textarea></label><div class="grid-two">${[['district','Bairro'],['street','Rua'],['number','Número'],['extra','Complemento'],['reference','Referência']].map(([key,title]) => ui.field(key,title,'text',sale?.address[key] ?? '', 'maxlength="200"')).join('')}</div></details><details id="sale-registration"><summary>Atendente e RevGás</summary>${ui.userField()}${select('posted','Lançamento no RevGás',{no:'Ainda não lançada',yes:'Já lançada'},sale?.posted ? 'yes' : 'no')}</details><p id="sale-recorder" class="muted"></p>${sale ? ui.field('reason','Justificativa da correção','text','','required maxlength="500"') : ''}`;

  function parseItems() {
    return rows('.item-row').map(row => ({ product: row.querySelector('[name=product]').value, quantity: Number(row.querySelector('[name=quantity]').value), total: money(row.querySelector('[name=itemTotal]').value), benefit: $('#benefit-mode').checked && row.querySelector('[name=benefitItem]').checked }));
  }
  function normalTotals(items) {
    const totals = { gas: 0, water: 0 };
    items.filter(item => !item.benefit).forEach(item => { totals[PRODUCTS[item.product].category] += item.total; });
    return totals;
  }
  function payments(items) {
    const totals = normalTotals(items);
    if (!items.some(item => !item.benefit)) return [];
    if (!$('#split-payment').checked) return Object.entries(totals).filter(([,total]) => total>0).map(([category,amount]) => ({ category, amount, method: $('[name=simpleMethod]').value }));
    return rows('.payment-row').map(row => ({ category: row.querySelector('[name=category]').value, method: row.querySelector('[name=method]').value, amount: money(row.querySelector('[name=paymentAmount]').value) }));
  }
  function input(values) {
    const items = parseItems();
    const benefitTotal = items.filter(item => item.benefit).reduce((sum,item) => sum+item.total,0);
    if ($('#benefit-mode').checked && !benefitTotal) throw new Error('Marque um P13 pelo benefício ou desmarque Gás do Povo.');
    const allocated = payments(items);
    if (benefitTotal) allocated.push({category:'gas',method:'benefit',amount:benefitTotal});
    const fee = $('#has-fee').checked ? { amount: money(values.feeAmount), method: values.feeMethod, status: values.feeStatus } : null;
    return { customer: values.customer, items, payments: allocated, fee, tendered: values.tendered ? money(values.tendered) : undefined, changeFrom: values.changeFrom ?? 'fund', delivery: {driver: values.driver,driverOther: values.driverOther ?? '',status: values.deliveryStatus}, notes: values.notes, address: Object.fromEntries(['district','street','number','extra','reference'].map(key => [key,values[key]])), posted: values.posted === 'yes' };
  }
  ui.openModal(sale ? 'Corrigir venda' : 'Nova venda', fields, async values => ui.commit(next => sale ? editSale(next,sale.id,input(values),values.reason,values.user) : createSale(next,input(values),values.user)), sale ? 'Salvar correção' : 'Registrar venda');

  function setEnabled(container, enabled) {
    container.hidden = !enabled;
    container.querySelectorAll('input,select').forEach(element => { element.disabled = !enabled; });
  }
  function updateDelivery(event) {
    const driver = $('[name=driver]').value;
    const status = $('[name=deliveryStatus]');
    const old = status.value;
    const allowed = driver === 'Depósito' ? ['pickup','collected'] : ['awaiting','out','delivered'];
    // Não presumir entrega concluída. Só o usuário pode confirmar a conclusão.
    const selected = event?.target?.name === 'driver' ? (allowed.includes(old) ? old : allowed[0]) : old;
    if (!allowed.includes(selected)) allowed.push(selected);
    status.innerHTML = allowed.map(key => `<option value="${key}" ${key === selected ? 'selected' : ''}>${DELIVERY[key]}</option>`).join('');
    setEnabled($('#other-driver'),driver === 'Outro');
    $('[name=driverOther]').required = driver === 'Outro';
  }
  function recalculate(event) {
    const benefit = $('#benefit-mode').checked;
    const productRows = rows('.item-row');
    const p13Count = productRows.filter(row => row.querySelector('[name=product]').value === 'p13').length;
    for (const row of productRows) {
      const product = row.querySelector('[name=product]').value;
      const flag = row.querySelector('[name=benefitItem]');
      if (!benefit || product !== 'p13') flag.checked = false;
      else if (event?.target?.id === 'benefit-mode' || event?.target === row.querySelector('[name=product]')) flag.checked = true;
      row.querySelector('.item-benefit').hidden = !benefit || product !== 'p13' || (p13Count === 1 && flag.checked);
      row.querySelector('.remove-row').hidden = productRows.length === 1;
      const total = row.querySelector('[name=itemTotal]');
      if (flag.checked) {
        const amount = Number(row.querySelector('[name=quantity]').value) * price;
        total.value = Number.isSafeInteger(amount) && amount>=0 ? inputMoney(amount) : '';
      }
      total.readOnly = flag.checked;
    }
    const normal = productRows.some(row => !row.querySelector('[name=benefitItem]').checked);
    setEnabled($('#normal-payments'),normal);
    const split = $('#split-payment').checked;
    setEnabled($('#split-fields'),normal && split);
    $('[name=simpleMethod]').disabled = !normal || split;
    $('[name=simpleMethod]').closest('label').hidden = split;
    $('#benefit-help').hidden = !benefit;
    $('#benefit-fee').hidden = !benefit;
    if (!benefit) $('#has-fee').checked = false;
    const hasFee = benefit && $('#has-fee').checked;
    setEnabled($('#fee-fields'),hasFee);
    updateDelivery(event);
    $('#sale-recorder').textContent = `Registro por ${$('[name=user]').value || 'informe a atendente'} · RevGás: ${$('[name=posted]').value === 'yes' ? 'já lançada' : 'pendente'}.`;
    if (!$('[name=user]').value) $('#sale-registration').open = true;
    for (const row of rows('.payment-row')) row.querySelector('.remove-row').hidden = rows('.payment-row').length === 1;
    let items;
    try { items = parseItems(); } catch {
      $('#sale-totals').textContent = 'Informe o total da linha para calcular a venda.';
      $('#payment-summary').textContent = '';
      $('#order-change').textContent = '';
      setEnabled($('#cash-fields'),false);
      return;
    }
    const total = items.reduce((sum,item) => sum+item.total,0) + (hasFee ? safelyMoney($('[name=feeAmount]').value) : 0);
    $('#sale-totals').textContent = `Total da venda: ${currency(total)}`;
    const totals = normalTotals(items);
    if (split && !splitInitialized) {
      const category = Object.keys(totals).find(key => totals[key]>0) ?? 'gas';
      $('#payment-rows').innerHTML = paymentRow({category,method:$('[name=simpleMethod]').value,amount:totals[category]});
      splitInitialized = true;
      setEnabled($('#split-fields'),normal);
    }
    const presentCategories = Object.keys(totals).filter(key => totals[key]>0);
    for (const row of rows('.payment-row')) {
      const selectCategory = row.querySelector('[name=category]');
      if (presentCategories.length === 1) selectCategory.value = presentCategories[0];
      selectCategory.closest('label').hidden = presentCategories.length === 1;
    }
    try {
      const allocated = payments(items);
      $('#payment-summary').textContent = !split ? allocated.map(p => `${CATEGORIES[p.category]}: ${currency(p.amount)} em ${METHODS[p.method]}`).join(' · ') : '';
      $('#allocation-summary').textContent = presentCategories.map(category => {
        const difference = totals[category] - allocated.filter(p => p.category===category).reduce((sum,p) => sum+p.amount,0);
        return `${CATEGORIES[category]}: ${difference===0 ? 'conferido' : difference>0 ? `falta ${currency(difference)}` : `excede ${currency(-difference)}`}`;
      }).join(' · ');
      let cash = allocated.filter(p => p.method==='cash').reduce((sum,p) => sum+p.amount,0);
      if (hasFee && $('[name=feeStatus]').value==='paid' && $('[name=feeMethod]').value==='cash') cash += safelyMoney($('[name=feeAmount]').value);
      setEnabled($('#cash-fields'),cash>0);
      if (!cash) { $('[name=tendered]').value=''; $('#order-change').textContent=''; return; }
      $('[name=tendered]').placeholder = `Valor exato: ${inputMoney(cash)}`;
      const tendered = $('[name=tendered]').value ? money($('[name=tendered]').value) : cash;
      const change = tendered-cash;
      $('#order-change').textContent = change<0 ? `Faltam ${currency(-change)} para cobrir a parte em dinheiro.` : change ? `Troco: ${currency(change)}` : `Em dinheiro: ${currency(cash)} · sem troco`;
      $('#change-account').hidden = change<=0;
    } catch {
      $('#payment-summary').textContent = 'Complete os valores das parcelas.';
      $('#allocation-summary').textContent = '';
      // Não ocultar o dinheiro já digitado por causa de uma parcela incompleta.
      if (rows('.payment-row').some(row => row.querySelector('[name=method]').value==='cash')) setEnabled($('#cash-fields'),true);
    }
  }
  function safelyMoney(value) { try { return money(value); } catch { return 0; } }
  $('#add-item').onclick = () => {
    if (rows('.item-row').length>=30) return;
    $('#item-rows').insertAdjacentHTML('beforeend',itemRow());
    $('#item-rows').lastElementChild.querySelector('[name=benefitItem]').checked = $('#benefit-mode').checked;
    recalculate();
  };
  $('#add-payment').onclick = () => {
    if (rows('.payment-row').length>=30) return;
    let category = 'gas';
    try { category = Object.keys(normalTotals(parseItems())).find(key => normalTotals(parseItems())[key]>0) ?? 'gas'; } catch { /* Validação no envio. */ }
    splitInitialized = true;
    $('#payment-rows').insertAdjacentHTML('beforeend',paymentRow({category,method:'pix',amount:''}));
    recalculate();
  };
  const form = $('#modal-fields');
  form.onclick = event => {
    if (event.target.classList.contains('remove-row')) { event.target.closest('.item-row,.payment-row').remove(); recalculate(); }
  };
  form.oninput = form.onchange = recalculate;
  recalculate();
}
