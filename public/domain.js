export const TYPES = {
  income: 'Entrada de dinheiro', expense: 'Saída de dinheiro', sale: 'Venda em espécie',
  transfer: 'Transferência entre caixa e fundo', replenish: 'Reposição do fundo',
  adjustment: 'Ajuste de conferência', reversal: 'Estorno',
  operationalSale: 'Venda de produtos', debtReceipt: 'Recebimento de dívida',
};
export const ACCOUNTS = { cash: 'Caixa (fora do fundo)', fund: 'Fundo de troco', external: 'Externo' };
export function money(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(,\d{1,2})?$/.test(value.trim())) throw new Error('Informe reais sem pontos, com até duas casas decimais (ex.: 1200,50).');
  const [whole, decimals = ''] = value.trim().split(',');
  return cents(Number(whole) * 100 + Number(decimals.padEnd(2, '0')));
}
export function cents(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999999999999) throw new Error('Valor monetário inválido ou acima do limite.');
  return value;
}
export function text(value, label, required = true, max = 500) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error(`${label}: preencha um texto válido (até ${max} caracteres).`);
  return value.trim();
}
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Informe uma data válida.');
  return value;
}
const positive = value => { cents(value); if (value === 0) throw new Error('O valor deve ser maior que zero.'); return value; };
const account = value => { if (!['cash', 'fund'].includes(value)) throw new Error('Conta inválida.'); return value; };
function entry(from, to, amount, kind) { return { from, to, amount: positive(amount), kind }; }
function balanceDay(day) {
  let cash = cents(day.initialCash), fund = cents(day.initialFund);
  for (const movement of day.movements) {
    for (const leg of movement.entries) {
      for (const [name, sign] of [[leg.from, -1], [leg.to, 1]]) {
        if (name === 'cash') cash += sign * leg.amount;
        if (name === 'fund') fund += sign * leg.amount;
      }
    }
    if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(fund)) throw new Error('Saldo acima do limite.');
  }
  return { cash, fund };
}
export function summary(day) {
  const { cash, fund } = balanceDay(day);
  let income = 0, expense = 0, sales = 0, transfers = 0, adjustments = 0;
  for (const movement of day.movements) {
    for (const leg of movement.entries) {
      if (leg.from !== 'external' && leg.to !== 'external') {
        transfers += leg.amount;
      } else {
        const signed = leg.from === 'external' ? leg.amount : -leg.amount;
        if (['saleReceipt', 'saleChange'].includes(leg.kind)) sales += signed;
        if (leg.kind === 'adjustment') adjustments += signed;
        // Totais brutos de dinheiro físico recebido e entregue, inclusive troco.
        if (signed > 0) income += signed;
        else expense -= signed;
      }
    }
  }
  return {
    cash, fund, total: cash + fund, income, expense, sales, transfers, adjustments,
    missing: Math.max(0, day.referenceFund - fund), excess: Math.max(0, fund - day.referenceFund),
  };
}
export function addMovement(day, input) {
  if (day.closing) throw new Error('Caixa fechado: não é possível lançar ou estornar.');
  const type = input.type;
  if (!['income', 'expense', 'sale', 'transfer', 'replenish', 'adjustment'].includes(type)) throw new Error('Tipo inválido.');
  const description = text(input.description, 'Descrição');
  const user = text(input.user ?? '', 'Responsável', type !== 'expense', 100) || 'Não informado';
  let entries;
  if (type === 'income') entries = [entry('external', account(input.account), input.amount, 'income')];
  if (type === 'expense') entries = [entry(account(input.account), 'external', input.amount, 'expense')];
  if (type === 'sale') {
    const amount = positive(input.amount), received = positive(input.received);
    if (received < amount) throw new Error('O valor recebido deve cobrir o valor da venda.');
    const change = received - amount;
    entries = [entry('external', 'cash', received, 'saleReceipt')];
    if (change) entries.push(entry('fund', 'external', change, 'saleChange'));
  }
  if (type === 'transfer' || type === 'replenish') {
    const from = type === 'replenish' ? 'cash' : account(input.from);
    const to = type === 'replenish' ? 'fund' : account(input.to);
    if (from === to) throw new Error('Origem e destino devem ser diferentes.');
    entries = [entry(from, to, input.amount, 'transfer')];
  }
  if (type === 'adjustment') {
    if (!['increase', 'decrease'].includes(input.direction)) throw new Error('Selecione a direção do ajuste.');
    const target = account(input.account);
    entries = [input.direction === 'increase' ? entry('external', target, input.amount, 'adjustment') : entry(target, 'external', input.amount, 'adjustment')];
  }
  const movement = {
    id: crypto.randomUUID(), dayId: day.id, createdAt: new Date().toISOString(), type,
    description, user, notes: text(input.notes ?? '', 'Observações', false), syncStatus: 'pending', entries,
    ...(type === 'sale' ? { saleAmount: input.amount, received: input.received } : {}),
  };
  const next = { ...day, movements: [...day.movements, movement] };
  const balances = balanceDay(next);
  // Venda e troco são atômicos; nenhuma conta pode terminar negativa.
  if (balances.cash < 0 || balances.fund < 0) throw new Error('Saldo insuficiente no caixa ou no fundo de troco. Reponha ou transfira antes de lançar.');
  cents(balances.cash); cents(balances.fund); cents(balances.cash + balances.fund);
  return next;
}
export function reverseMovement(day, id, reason, user, commerce = false) {
  if (day.closing) throw new Error('Caixa fechado: não é possível estornar.');
  const original = day.movements.find(m => m.id === id);
  if (!original || original.type === 'reversal') throw new Error('Lançamento inválido para estorno.');
  if (original.commerceId && !commerce) throw new Error('Use o estorno da venda ou do recebimento para manter os relatórios consistentes.');
  if (day.movements.some(m => m.reverses === id)) throw new Error('Este lançamento já foi estornado.');
  const movement = {
    id: crypto.randomUUID(), dayId: day.id, createdAt: new Date().toISOString(), type: 'reversal',
    description: text(reason, 'Justificativa do estorno'), user: text(user, 'Responsável', true, 100), syncStatus: 'pending',
    reverses: id, entries: original.entries.map(leg => ({ ...leg, from: leg.to, to: leg.from })),
  };
  const next = { ...day, movements: [...day.movements, movement] };
  const s = balanceDay(next);
  if (s.cash < 0 || s.fund < 0) throw new Error('Estorno deixaria saldo negativo. Confira as movimentações posteriores e a origem dos valores.');
  cents(s.cash); cents(s.fund); cents(s.cash + s.fund);
  return next;
}
export function closeDay(day, input) {
  if (day.closing) throw new Error('Caixa já fechado.');
  const countedCash = cents(input.countedCash), countedFund = cents(input.countedFund);
  cents(countedCash + countedFund);
  const expected = summary(day);
  const notes = text(input.notes ?? '', 'Observações', false);
  if ((countedCash !== expected.cash || countedFund !== expected.fund) && !notes) throw new Error('Explique as diferenças de conferência nas observações.');
  return { ...day, closing: {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), syncStatus: 'pending',
    user: text(input.user, 'Responsável', true, 100), notes, countedCash, countedFund, expected,
    cashDifference: countedCash - expected.cash, fundDifference: countedFund - expected.fund,
    difference: countedCash + countedFund - expected.total,
  } };
}
export function openDay(days, input) {
  const dayDate = date(input.date);
  if (days.some(day => day.date === dayDate)) throw new Error('Já existe um caixa para esta data. Consulte o histórico; reabertura não disponível nesta versão.');
  if (days.some(day => !day.closing)) throw new Error('Feche o caixa aberto antes de iniciar outro expediente.');
  const initialCash = cents(input.initialCash), initialFund = cents(input.initialFund);
  cents(initialCash + initialFund);
  return {
    id: crypto.randomUUID(), date: dayDate, createdAt: new Date().toISOString(), syncStatus: 'pending',
    initialCash, initialFund, referenceFund: 10000, notes: text(input.notes ?? '', 'Observações', false),
    user: text(input.user, 'Responsável', true, 100), movements: [], closing: null,
  };
}

// Ponte atômica para vendas/recebimentos. Não altera o comportamento do legado.
export function recordCommerceCash(day, { type, commerceId, entries, description, user }) {
  if (day.closing) throw new Error('Caixa fechado: não é possível lançar.');
  if (!['operationalSale', 'debtReceipt'].includes(type)) throw new Error('Operação inválida.');
  const checked = entries.map(leg => {
    if (!['cash', 'fund', 'external'].includes(leg.from) || !['cash', 'fund', 'external'].includes(leg.to) || leg.from === leg.to) throw new Error('Origem/destino inválidos.');
    return { ...leg, amount: positive(leg.amount) };
  });
  const movement = { id: crypto.randomUUID(), dayId: day.id, createdAt: new Date().toISOString(), syncStatus: 'pending', type, commerceId, entries: checked, description: text(description, 'Descrição'), user: text(user, 'Responsável', true, 100) };
  const next = { ...day, movements: [...day.movements, movement] };
  const s = summary(next);
  if (s.cash < 0 || s.fund < 0) throw new Error('Saldo insuficiente para o troco. Confira a conta de origem ou transfira antes de lançar.');
  cents(s.cash); cents(s.fund); cents(s.total);
  return { day: next, movementId: movement.id };
}
