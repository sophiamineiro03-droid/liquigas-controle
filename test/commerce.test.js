import test from 'node:test';
import assert from 'node:assert/strict';
import { openDay, summary, closeDay, addMovement, reverseMovement } from '../public/domain.js';
import { prepareState, createSale, editSale, cancelSale, updateSale, addReceipt, reverseReceipt, balancesDue, report, configureBenefit, recordSmallNotes } from '../public/commerce.js';
const user = 'Atendente';
const start = () => prepareState({ revision: 0, version: 1, days: [openDay([], { date: '2026-11-12', initialCash: 50000, initialFund: 10000, user })] });
const fields = (extra = {}) => ({ customer: 'Maria', items: [{ product: 'p13', quantity: 1, total: 12000 }], payments: [{ category: 'gas', method: 'cash', amount: 12000 }], delivery: { driver: 'Depósito', status: 'pickup' }, posted: false, ...extra });
const daily = state => report(state, state.days[0].id);
const sale = state => state.business.sales[0];

test('venda mista e pagamento dividido mantêm categorias sem rateio inventado', () => {
  const state = createSale(start(), fields({ items: [{ product: 'p13', quantity: 2, total: 24000 }, { product: 'water20', quantity: 3, total: 3000 }], payments: [{ category: 'gas', method: 'cash', amount: 10000 }, { category: 'gas', method: 'pix', amount: 14000 }, { category: 'water', method: 'credit', amount: 3000 }], tendered: 15000 }), user);
  const r = daily(state);
  assert.equal(r.categories.gas.sold, 24000); assert.equal(r.categories.water.sold, 3000);
  assert.equal(r.payments.cash, 10000); assert.equal(r.payments.pix, 14000); assert.equal(r.payments.credit, 3000);
  assert.equal(r.received, 27000); assert.equal(r.physical.cash, 65000); assert.equal(r.physical.fund, 5000);
  assert.equal(r.physical.total, 70000);
  assert.deepEqual(r.quantities.p13, { sold: 2, delivered: 0, pending: 2 });
  assert.deepEqual(r.quantities.water20, { sold: 3, delivered: 0, pending: 3 });
});

test('Pix, cartões e fiado não aumentam dinheiro na gaveta', () => {
  for (const method of ['pix','debit','credit','creditSale']) {
    const state = createSale(start(), fields({ payments: [{ category: 'gas', method, amount: 12000 }] }), user);
    assert.equal(daily(state).physical.total, 60000);
    assert.equal(daily(state).sales, 12000);
    assert.equal(daily(state).pending, method === 'creditSale' ? 12000 : 0);
  }
});

test('Gás do Povo: benefício de 107,98 e taxa de 10 reais discriminados sem duplicação', () => {
  for (const method of ['cash','pix','debit','credit']) {
    const state = createSale(start(), fields({ items: [{ product: 'p13', quantity: 1, total: 10798 }], payments: [{ category: 'gas', method: 'benefit', amount: 10798 }], fee: { amount: 1000, method, status: 'paid' }, delivery: { driver: 'Wagner', status: 'awaiting' } }), user);
    const r = daily(state);
    assert.equal(r.payments.benefit, 10798); assert.equal(r.payments[method], 1000);
    assert.equal(r.benefitQuantity, 1); assert.equal(r.sales, 11798); assert.equal(r.received, 11798);
    assert.equal(r.categories.gas.products, 10798); assert.equal(r.categories.gas.feeBilled, 1000);
    assert.equal(r.physical.total, method === 'cash' ? 61000 : 60000);
  }
});

test('taxa pendente não é recebida até quitação vinculada, sem nova venda', () => {
  let state = createSale(start(), fields({ items: [{ product: 'p13', quantity: 1, total: 10798 }], payments: [{ category: 'gas', method: 'benefit', amount: 10798 }], fee: { amount: 1000, method: 'cash', status: 'pending' }, delivery: { driver: 'Vinicius', status: 'out' } }), user);
  assert.equal(daily(state).received, 10798); assert.equal(daily(state).pending, 1000);
  state = addReceipt(state, { saleId: sale(state).id, target: 'fee', method: 'cash', amount: 1000 }, user);
  assert.equal(daily(state).received, 11798); assert.equal(daily(state).sales, 11798);
  assert.equal(daily(state).pending, 0); assert.equal(daily(state).categories.gas.fees.cash, 1000);
});

test('preço configurável só altera novas vendas e mantém unidades corretas', () => {
  let state = createSale(start(), fields({ items: [{ product: 'p13', quantity: 2, total: 21596 }], payments: [{ category: 'gas', method: 'benefit', amount: 10000 }, { category: 'gas', method: 'benefit', amount: 11596 }] }), user);
  state = configureBenefit(state, 11000, user);
  state = createSale(state, fields({ items: [{ product: 'p13', quantity: 1, total: 11000 }], payments: [{ category: 'gas', method: 'benefit', amount: 11000 }] }), user);
  assert.equal(sale(state).benefitPrice, 10798);
  assert.equal(state.business.sales[1].benefitPrice, 11000);
  assert.equal(daily(state).benefitQuantity, 3);
});

test('valida soma por categoria, quantidade, Gás do Povo, taxa, troco e responsável', () => {
  const state = start();
  for (const data of [
    fields({ payments: [{ category: 'water', method: 'cash', amount: 12000 }] }),
    fields({ items: [{ product: 'p13', quantity: 1.5, total: 12000 }] }),
    fields({ items: [{ product: 'water20', quantity: 1, total: 10798 }], payments: [{ category: 'water', method: 'benefit', amount: 10798 }] }),
    fields({ items: [{ product: 'p13', quantity: 1, total: 12000 }], payments: [{ category: 'gas', method: 'benefit', amount: 12000 }] }),
    fields({ fee: { amount: 1000, method: 'cash', status: 'paid' } }),
    fields({ tendered: 1000 }), fields({ tendered: 99999 }), fields({ customer: 'x'.repeat(101) }),
    fields({ payments: [{ category: 'gas', method: 'cash', amount: 0 }] }),
  ]) assert.throws(() => createSale(state, data, user));
  assert.throws(() => createSale(state, fields(), ''));
  assert.equal(state.days[0].movements.length, 0); assert.equal(state.business.sales.length, 0);
});

test('recebimento parcial de venda fiada reduz pendência e não aumenta faturamento', () => {
  let state = createSale(start(), fields({ items: [{ product: 'p13', quantity: 2, total: 20000 }], payments: [{ category: 'gas', method: 'creditSale', amount: 20000 }] }), user);
  state = addReceipt(state, { saleId: sale(state).id, target: 'gas', amount: 10000, method: 'pix' }, user);
  assert.equal(balancesDue(state, sale(state)).gas, 10000);
  assert.equal(daily(state).sales, 20000); assert.equal(daily(state).received, 10000); assert.equal(daily(state).physical.total, 60000);
  assert.throws(() => addReceipt(state, { saleId: sale(state).id, target: 'gas', amount: 10001, method: 'cash' }, user));
  assert.throws(() => cancelSale(state, sale(state).id, 'Cancelar', user));
  assert.throws(() => reverseMovement(state.days[0], state.business.receipts[0].movementId, 'teste', user));
  const reversed = reverseReceipt(state, state.business.receipts[0].id, 'Pagamento anotado incorretamente', user);
  assert.equal(daily(reversed).pending, 20000); assert.equal(daily(reversed).received, 0);
  assert.equal(reversed.business.receipts[0].reversed, true);
});

test('recebimento antigo sem vínculo registra apenas recebido e não inventa dívida', () => {
  const state = addReceipt(start(), { customer: 'José', amount: 10000, category: 'water', method: 'cash', notes: 'Dívida de folha antiga' }, user);
  assert.equal(daily(state).sales, 0); assert.equal(daily(state).pending, 0);
  assert.equal(daily(state).previousDebtReceived, 10000); assert.equal(daily(state).categories.water.payments.cash, 10000);
  assert.equal(daily(state).physical.cash, 60000);
  assert.equal(state.business.receipts[0].saleId, null);
});

test('recebimento em outro dia preserva fechamento antigo e não repete vendas', () => {
  let state = createSale(start(), fields({ payments: [{ category: 'gas', method: 'creditSale', amount: 12000 }] }), user);
  const frozen = closeDay(state.days[0], { countedCash: 50000, countedFund: 10000, user });
  state.days[0] = frozen;
  state.days.push(openDay(state.days, { date: '2026-11-13', initialCash: 10000, initialFund: 10000, user }));
  state = addReceipt(state, { saleId: sale(state).id, target: 'gas', amount: 6000, method: 'cash' }, user);
  const r = report(state, state.days[1].id);
  assert.equal(r.sales, 0); assert.equal(r.previousDebtReceived, 6000); assert.equal(r.pending, 6000);
  assert.equal(r.physical.cash, 16000); assert.deepEqual(state.days[0], frozen);
});

test('correção e cancelamento auditáveis atualizam totais e preservam movimentos', () => {
  let state = createSale(start(), fields(), user);
  const saleId = sale(state).id;
  state = editSale(state, saleId, fields({ items: [{ product: 'water20', quantity: 3, total: 3000 }], payments: [{ category: 'water', method: 'pix', amount: 3000 }] }), 'Produto e pagamento incorretos', user);
  assert.equal(daily(state).categories.gas.sold, 0); assert.equal(daily(state).categories.water.sold, 3000);
  assert.equal(daily(state).physical.total, 60000); assert.equal(state.days[0].movements.length, 3);
  assert.equal(state.business.events[1].before.items[0].product, 'p13');
  state = cancelSale(state, saleId, 'Venda cancelada', user);
  assert.equal(daily(state).sales, 0); assert.equal(daily(state).quantities.water20.sold, 0);
  assert.equal(state.days[0].movements.length, 4); assert.equal(state.business.sales.length, 1);
  assert.throws(() => cancelSale(state, saleId, 'De novo', user));
});

test('entrega e RevGás independem do pagamento e podem atualizar após fechamento', () => {
  let state = createSale(start(), fields({ payments: [{ category: 'gas', method: 'creditSale', amount: 12000 }] }), user);
  const opening = summary(state.days[0]);
  state.days[0] = closeDay(state.days[0], { countedCash: opening.cash, countedFund: opening.fund, user });
  state = updateSale(state, sale(state).id, { delivery: { driver: 'Wagner', status: 'delivered' }, posted: true, notes: 'Entrega realizada às 15h' }, 'Entrega confirmada', user);
  assert.equal(daily(state).quantities.p13.delivered, 1); assert.equal(daily(state).deliveries, 0);
  assert.equal(daily(state).unposted, 0); assert.equal(daily(state).pending, 12000);
  assert.equal(state.days[0].closing.expected.total, opening.total);
  assert.throws(() => editSale(state, sale(state).id, fields(), 'Mudou valor', user));
});

test('transferência do fundo e alerta de notas não são receitas ou despesas', () => {
  let state = start();
  state.days[0] = addMovement(state.days[0], { type: 'transfer', from: 'fund', to: 'cash', amount: 4000, description: 'Troco no caixa', user });
  state = recordSmallNotes(state, true, 'Faltam moedas, não dinheiro', user);
  assert.equal(daily(state).physical.fund, 6000); assert.equal(daily(state).physical.cash, 54000);
  assert.equal(daily(state).physical.total, 60000); assert.equal(daily(state).expense, 0);
  assert.equal(daily(state).received, 0); assert.equal(state.days[0].smallNotesNeeded, true);
  state.days[0] = addMovement(state.days[0], { type: 'replenish', amount: 4000, description: 'Reposição', user });
  assert.equal(daily(state).physical.fund, 10000);
  state.days[0] = addMovement(state.days[0], { type: 'expense', account: 'cash', amount: 5000, description: 'Conta paga', notes: 'Conta de energia' });
  assert.equal(daily(state).expense, 5000); assert.equal(daily(state).physical.cash, 45000);
  assert.equal(state.days[0].movements.at(-1).user, 'Não informado');
  state.days[0] = reverseMovement(state.days[0], state.days[0].movements.at(-1).id, 'Conta não paga', user);
  assert.equal(daily(state).expense, 0);
});

test('dados legados permanecem intactos e fora de categorias desconhecidas', () => {
  const old = { revision: 4, days: [openDay([], { date: '2026-11-12', initialCash: 50000, initialFund: 10000, user })] };
  old.days[0] = addMovement(old.days[0], { type: 'sale', amount: 12000, received: 12000, description: 'Venda antiga', user });
  const copy = structuredClone(old);
  const upgraded = prepareState(old);
  assert.deepEqual(old, copy); assert.equal(upgraded.revision, 4);
  assert.deepEqual(upgraded.days, old.days);
  assert.equal(daily(upgraded).sales, 0); assert.equal(daily(upgraded).legacySales, 12000);
  assert.equal(daily(upgraded).physical.total, 72000);
});

test('P13 pelo benefício e água ou P13 normais coexistem com pagamentos discriminados', () => {
  const state = createSale(start(), fields({ items: [
    { product: 'p13', quantity: 1, total: 10798, benefit: true },
    { product: 'p13', quantity: 1, total: 12000, benefit: false },
    { product: 'water20', quantity: 2, total: 2000, benefit: false },
  ], payments: [
    { category: 'gas', method: 'benefit', amount: 10798 },
    { category: 'gas', method: 'cash', amount: 12000 },
    { category: 'water', method: 'pix', amount: 2000 },
  ], fee: { amount: 1000, method: 'pix', status: 'paid' }, delivery: { driver: 'Wagner', status: 'awaiting' } }), user);
  const r = daily(state);
  assert.equal(r.benefitQuantity, 1); assert.equal(r.quantities.p13.sold, 2);
  assert.equal(r.payments.benefit, 10798); assert.equal(r.payments.cash, 12000); assert.equal(r.payments.pix, 3000);
  assert.equal(r.categories.gas.sold, 23798); assert.equal(r.categories.water.sold, 2000);
  assert.equal(r.physical.cash, 62000); assert.equal(r.physical.fund, 10000);
});
