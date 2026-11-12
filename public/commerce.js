import { cents, text, summary, recordCommerceCash, reverseMovement } from './domain.js';

export const PRODUCTS = {
  p13: { name: 'P13', category: 'gas' }, p08: { name: 'P08', category: 'gas' }, p45: { name: 'P45', category: 'gas' },
  water20: { name: 'Galão de água 20 L', category: 'water' }, pack510: { name: 'Fardo de água 510 ml', category: 'water' },
};
export const METHODS = { cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', credit: 'Crédito', creditSale: 'Fiado / A receber', benefit: 'Gás do Povo' };
export const CATEGORIES = { gas: 'Gás', water: 'Água' };
export const DELIVERY = { awaiting: 'Aguardando entrega', out: 'Saiu para entrega', delivered: 'Entregue', pickup: 'Aguardando retirada', collected: 'Retirado no depósito', canceled: 'Cancelado' };
export const DRIVERS = ['Wagner', 'Vinicius', 'Depósito', 'Outro'];
export function prepareState(state) {
  return { ...state, business: state.business ?? { schemaVersion: 1, benefitPrice: 10798, sales: [], receipts: [], events: [] } };
}
const working = state => structuredClone(prepareState(state));
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const positive = value => { cents(value); if (!value) throw new Error('O valor deve ser maior que zero.'); return value; };
function option(value, values, title) { if (!Object.hasOwn(values, value)) throw new Error(`${title} inválido.`); return value; }
function open(state) { const day = state.days.find(day => !day.closing); if (!day) throw new Error('Abra um caixa para registrar a operação.'); return day; }
function dayFor(state, dayId) { const day = state.days.find(day => day.id === dayId); if (!day || day.closing) throw new Error('O expediente original está fechado. Alterações financeiras não são permitidas.'); return day; }
function putDay(state, day) { state.days = state.days.map(item => item.id === day.id ? day : item); }
function audit(state, type, entityId, user, reason, before, after) {
  state.business.events.push({ id: id(), type, entityId, createdAt: now(), user: text(user, 'Responsável', true, 100), reason: text(reason, 'Motivo'), before, after, syncStatus: 'pending' });
}
function delivery(input) {
  if (!DRIVERS.includes(input.driver)) throw new Error('Selecione o responsável pela entrega/retirada.');
  const status = option(input.status, DELIVERY, 'Situação da entrega');
  if (status === 'canceled') throw new Error('Para cancelar, use Cancelar e estornar.');
  const driverOther = text(input.driverOther ?? '', 'Nome do responsável pela entrega', input.driver === 'Outro', 100);
  return { driver: input.driver, driverOther, status };
}
function normalizeSale(state, input) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) throw new Error('Informe entre 1 e 30 produtos.');
  const items = input.items.map(item => {
    option(item.product, PRODUCTS, 'Produto');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99999) throw new Error('Quantidade deve ser um inteiro entre 1 e 99999.');
    if (item.benefit != null && typeof item.benefit !== 'boolean') throw new Error('Informe se o produto usa o benefício.');
    return { product: item.product, quantity: item.quantity, total: positive(item.total), benefit: item.benefit ?? null };
  });
  const totals = { gas: 0, water: 0 };
  items.forEach(item => { totals[PRODUCTS[item.product].category] += item.total; });
  cents(totals.gas + totals.water);
  if (!Array.isArray(input.payments) || !input.payments.length || input.payments.length > 30) throw new Error('Informe os pagamentos dos produtos.');
  const payments = input.payments.map(p => ({ category: option(p.category, CATEGORIES, 'Categoria'), method: option(p.method, METHODS, 'Pagamento'), amount: positive(p.amount) }));
  for (const category of Object.keys(totals)) {
    const allocated = payments.filter(p => p.category === category).reduce((sum, p) => sum + p.amount, 0);
    if (allocated !== totals[category]) throw new Error(`Pagamentos de ${CATEGORIES[category]} devem somar exatamente o valor dos produtos dessa categoria, incluindo fiado.`);
  }
  const benefit = payments.some(p => p.method === 'benefit');
  const benefitPrice = positive(input.benefitPrice ?? state.business.benefitPrice);
  for (const item of items) item.benefit ??= benefit && item.product === 'p13';
  const benefitItems = items.filter(item => item.benefit);
  const benefitTotal = benefitItems.reduce((sum,item) => sum+item.total,0);
  if (benefitItems.some(item => item.product !== 'p13' || item.total !== item.quantity * benefitPrice)) throw new Error('Gás do Povo exige P13 no valor configurado por unidade.');
  if (payments.filter(p => p.method === 'benefit').some(p => p.category !== 'gas') || payments.filter(p => p.method === 'benefit').reduce((sum,p) => sum+p.amount,0) !== benefitTotal) throw new Error('O pagamento pelo benefício deve corresponder exatamente aos P13 marcados como Gás do Povo.');
  if (benefit && !benefitItems.length) throw new Error('Marque quais P13 são pagos pelo Gás do Povo.');
  let fee = null;
  if (input.fee?.amount) {
    if (!benefit) throw new Error('Taxa adicional está disponível para Gás do Povo.');
    const method = option(input.fee.method, METHODS, 'Pagamento da taxa');
    if (method === 'benefit') throw new Error('Taxa não pode ser paga pelo benefício.');
    const status = option(input.fee.status, { paid: 1, pending: 1 }, 'Situação da taxa');
    if (method === 'creditSale' && status !== 'pending') throw new Error('Taxa fiada deve ficar pendente.');
    fee = { amount: positive(input.fee.amount), method, status };
  }
  cents(totals.gas + totals.water + (fee?.amount ?? 0));
  const cash = payments.filter(p => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0) + (fee?.status === 'paid' && fee.method === 'cash' ? fee.amount : 0);
  if (!cash && input.tendered) throw new Error('Esta venda não tem parcela em dinheiro. Limpe o dinheiro entregue pelo cliente.');
  const tendered = cash ? cents(input.tendered ?? cash) : 0;
  if (tendered < cash) throw new Error('O dinheiro entregue deve cobrir a parte paga em dinheiro.');
  if (!['fund', 'cash'].includes(input.changeFrom ?? 'fund')) throw new Error('Origem do troco inválida.');
  const address = Object.fromEntries(['district', 'street', 'number', 'extra', 'reference'].map(key => [key, text(input.address?.[key] ?? '', 'Endereço', false, 200)]));
  const deliveryInfo = delivery(input.delivery);
  if (fee && deliveryInfo.driver === 'Depósito') throw new Error('Taxa de entrega exige um responsável por entrega, não retirada no depósito.');
  if (typeof input.posted !== 'boolean') throw new Error('Informe a situação no RevGás.');
  return {
    customer: text(input.customer, 'Cliente', true, 100), items, payments, totals, fee, benefitPrice,
    tendered, change: tendered - cash, changeFrom: input.changeFrom ?? 'fund', cash,
    notes: text(input.notes ?? '', 'Observações', false), address, delivery: deliveryInfo, posted: input.posted,
  };
}
function bookSale(state, day, sale, user) {
  const entries = [];
  if (sale.tendered) entries.push({ from: 'external', to: 'cash', amount: sale.tendered, kind: 'saleReceipt' });
  if (sale.change) entries.push({ from: sale.changeFrom, to: 'external', amount: sale.change, kind: 'saleChange' });
  const result = recordCommerceCash(day, { type: 'operationalSale', commerceId: sale.id, entries, user, description: `Venda: ${sale.customer}` });
  putDay(state, result.day); sale.movementId = result.movementId;
}
export function createSale(state, input, user) {
  const next = working(state), day = open(next);
  const sale = { ...normalizeSale(next, { ...input, benefitPrice: next.business.benefitPrice }), id: id(), dayId: day.id, createdAt: now(), user: text(user, 'Responsável', true, 100), canceled: false, syncStatus: 'pending' };
  bookSale(next, day, sale, user);
  next.business.sales.push(sale);
  audit(next, 'saleCreated', sale.id, user, 'Cadastro de venda', null, sale);
  return next;
}
function findSale(state, saleId) {
  const sale = state.business.sales.find(s => s.id === saleId);
  if (!sale || sale.canceled) throw new Error('Venda não encontrada ou cancelada.');
  return sale;
}
function noReceipts(state, saleId) {
  if (state.business.receipts.some(r => r.saleId === saleId && !r.reversed)) throw new Error('Estorne os recebimentos associados antes de alterar valores ou cancelar a venda.');
}
export function editSale(state, saleId, input, reason, user) {
  const next = working(state), old = findSale(next, saleId), day = dayFor(next, old.dayId);
  noReceipts(next, saleId);
  const revised = { ...old, ...normalizeSale(next, { ...input, benefitPrice: old.benefitPrice }), updatedAt: now(), user: text(user, 'Responsável', true, 100) };
  const reversed = reverseMovement(day, old.movementId, text(reason, 'Justificativa da correção'), user, true);
  bookSale(next, reversed, revised, user);
  next.business.sales = next.business.sales.map(s => s.id === saleId ? revised : s);
  audit(next, 'saleEdited', saleId, user, reason, old, revised);
  return next;
}
export function cancelSale(state, saleId, reason, user) {
  const next = working(state), sale = findSale(next, saleId), day = dayFor(next, sale.dayId);
  noReceipts(next, saleId);
  putDay(next, reverseMovement(day, sale.movementId, reason, user, true));
  const canceled = { ...sale, canceled: true, canceledAt: now(), delivery: { ...sale.delivery, status: 'canceled' } };
  next.business.sales = next.business.sales.map(s => s.id === saleId ? canceled : s);
  audit(next, 'saleCanceled', saleId, user, reason, sale, canceled);
  return next;
}
export function updateSale(state, saleId, input, reason, user) {
  const next = working(state), sale = findSale(next, saleId);
  const revised = { ...sale, delivery: delivery(input.delivery), notes: text(input.notes ?? '', 'Observações', false), address: sale.address, posted: input.posted, updatedAt: now() };
  if (typeof revised.posted !== 'boolean') throw new Error('Informe a situação no RevGás.');
  next.business.sales = next.business.sales.map(s => s.id === saleId ? revised : s);
  audit(next, 'saleUpdated', saleId, user, reason, sale, revised);
  return next;
}
export function balancesDue(state, sale) {
  const due = { gas: 0, water: 0, fee: sale.fee?.status === 'pending' ? sale.fee.amount : 0 };
  if (sale.canceled) return { gas: 0, water: 0, fee: 0 };
  sale.payments.filter(p => p.method === 'creditSale').forEach(p => { due[p.category] += p.amount; });
  prepareState(state).business.receipts.filter(r => r.saleId === sale.id && !r.reversed).forEach(r => { due[r.target] -= r.amount; });
  return due;
}
export function addReceipt(state, input, user) {
  const next = working(state), day = open(next);
  const method = option(input.method, METHODS, 'Pagamento');
  if (['creditSale', 'benefit'].includes(method)) throw new Error('Recebimento exige dinheiro, Pix, débito ou crédito.');
  const amount = positive(input.amount);
  let sale, category, target;
  if (input.saleId) {
    sale = findSale(next, input.saleId);
    target = option(input.target, { gas: 1, water: 1, fee: 1 }, 'Destino do recebimento');
    if (amount > balancesDue(next, sale)[target]) throw new Error('Valor excede o saldo pendente da venda nessa categoria/taxa.');
    category = target === 'fee' ? 'gas' : target;
  } else category = option(input.category, CATEGORIES, 'Categoria do recebimento');
  const receipt = {
    id: id(), dayId: day.id, saleId: sale?.id ?? null, target: target ?? null, category,
    customer: sale?.customer ?? text(input.customer, 'Cliente', true, 100), amount, method,
    notes: text(input.notes ?? '', 'Observações', false), createdAt: now(), user: text(user, 'Responsável', true, 100), reversed: false, syncStatus: 'pending',
  };
  const result = recordCommerceCash(day, { type: 'debtReceipt', commerceId: receipt.id, user, description: `Recebimento: ${receipt.customer}`, entries: method === 'cash' ? [{ from: 'external', to: 'cash', amount, kind: 'debtReceipt' }] : [] });
  putDay(next, result.day); receipt.movementId = result.movementId;
  next.business.receipts.push(receipt);
  audit(next, 'receiptCreated', receipt.id, user, 'Recebimento de dívida', null, receipt);
  return next;
}
export function reverseReceipt(state, receiptId, reason, user) {
  const next = working(state), receipt = next.business.receipts.find(r => r.id === receiptId);
  if (!receipt || receipt.reversed) throw new Error('Recebimento inválido ou já estornado.');
  const day = dayFor(next, receipt.dayId);
  putDay(next, reverseMovement(day, receipt.movementId, reason, user, true));
  const reversed = { ...receipt, reversed: true, reversedAt: now() };
  next.business.receipts = next.business.receipts.map(r => r.id === receiptId ? reversed : r);
  audit(next, 'receiptReversed', receiptId, user, reason, receipt, reversed);
  return next;
}
export function configureBenefit(state, price, user) {
  const next = working(state), before = next.business.benefitPrice;
  next.business.benefitPrice = positive(price);
  audit(next, 'benefitPriceChanged', 'benefitPrice', user, 'Alteração do preço para novas vendas', before, price);
  return next;
}
export function recordSmallNotes(state, needed, reason, user) {
  const next = working(state), day = open(next);
  if (typeof needed !== 'boolean') throw new Error('Informe a situação das notas.');
  const before = day.smallNotesNeeded ?? false;
  day.smallNotesNeeded = needed;
  audit(next, 'smallNotesChanged', day.id, user, reason, before, needed);
  return next;
}
const methods = () => Object.fromEntries(['cash', 'pix', 'debit', 'credit', 'benefit'].map(method => [method, 0]));
export function report(state, dayId) {
  const { business } = prepareState(state);
  const sales = business.sales.filter(s => s.dayId === dayId && !s.canceled);
  const receipts = business.receipts.filter(r => r.dayId === dayId && !r.reversed);
  const category = () => ({ products: 0, feeBilled: 0, sold: 0, creditSold: 0, payments: methods(), fees: methods(), debtPayments: methods(), received: 0 });
  const categories = { gas: category(), water: category() };
  const quantities = Object.fromEntries(Object.keys(PRODUCTS).map(key => [key, { sold: 0, delivered: 0, pending: 0 }]));
  let benefitQuantity = 0;
  for (const sale of sales) {
    for (const item of sale.items) {
      const c = categories[PRODUCTS[item.product].category]; c.products += item.total; c.sold += item.total;
      const q = quantities[item.product]; q.sold += item.quantity;
      if (['delivered', 'collected'].includes(sale.delivery.status)) q.delivered += item.quantity;
      else q.pending += item.quantity;
    }
    for (const p of sale.payments) {
      if (p.method === 'creditSale') categories[p.category].creditSold += p.amount;
      else categories[p.category].payments[p.method] += p.amount;

    }
    if (sale.payments.some(p => p.method === 'benefit')) benefitQuantity += sale.items.filter(i => i.benefit ?? i.product === 'p13').reduce((sum, i) => sum + i.quantity, 0);
    if (sale.fee) {
      const c = categories.gas; c.sold += sale.fee.amount; c.feeBilled += sale.fee.amount;
      if (sale.fee.status === 'paid') { c.payments[sale.fee.method] += sale.fee.amount; c.fees[sale.fee.method] += sale.fee.amount; }
      else c.creditSold += sale.fee.amount;
    }
  }
  for (const r of receipts) {
    categories[r.category].payments[r.method] += r.amount;
    categories[r.category].debtPayments[r.method] += r.amount;
    if (r.target === 'fee') categories.gas.fees[r.method] += r.amount;
  }
  const payments = methods();
  for (const c of Object.values(categories)) {
    c.received = Object.values(c.payments).reduce((sum, amount) => sum + amount, 0);
    for (const method of Object.keys(payments)) payments[method] += c.payments[method];
  }
  let pending = 0;
  for (const sale of business.sales.filter(s => !s.canceled)) pending += Object.values(balancesDue(state, sale)).reduce((sum, amount) => sum + amount, 0);
  const day = state.days.find(d => d.id === dayId);
  const reversed = new Set(day?.movements.filter(m => m.reverses).map(m => m.reverses));
  const expenses = day?.movements.filter(m => m.type === 'expense' && !reversed.has(m.id)) ?? [];
  return {
    categories, payments, quantities, benefitQuantity, sales: categories.gas.sold + categories.water.sold,
    received: Object.values(payments).reduce((sum, amount) => sum + amount, 0),
    creditSold: categories.gas.creditSold + categories.water.creditSold, pending,
    pendingToday: sales.reduce((sum, sale) => sum + Object.values(balancesDue(state, sale)).reduce((a,b) => a+b, 0), 0),
    debtReceived: receipts.reduce((sum,r) => sum+r.amount, 0),
    previousDebtReceived: receipts.filter(r => !r.saleId || business.sales.find(s => s.id === r.saleId)?.dayId !== dayId).reduce((sum,r) => sum+r.amount, 0),
    expense: expenses.reduce((sum,m) => sum + m.entries.reduce((a,e) => a+e.amount, 0), 0), expenses,
    deliveries: sales.filter(s => !['delivered', 'collected'].includes(s.delivery.status)).length,
    unposted: sales.filter(s => !s.posted).length,
    deliveryQueue: business.sales.filter(s => !s.canceled && !['delivered', 'collected'].includes(s.delivery.status)).length,
    revGasQueue: business.sales.filter(s => !s.canceled && !s.posted).length,
    legacySales: day?.movements.filter(m => m.type === 'sale' && !reversed.has(m.id)).reduce((sum,m) => sum + m.saleAmount, 0) ?? 0,
    physical: day ? summary(day) : null,
  };
}
