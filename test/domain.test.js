import test from 'node:test';
import assert from 'node:assert/strict';
import { money, summary, addMovement, reverseMovement, closeDay, date } from '../public/domain.js';
const initial = () => ({ id: crypto.randomUUID(), date: '2026-11-12', initialCash: 100000, initialFund: 20000, referenceFund: 20000, movements: [] });
const input = extra => ({ description: 'Operação de teste', user: 'Atendente', ...extra });
test('converte BRL para centavos sem arredondar entradas inválidas', () => {
  assert.equal(money('1200,50'), 120050);
  assert.equal(money('0,01'), 1);
  assert.equal(money('12,5'), 1250);
  for (const value of ['-1', 'NaN', '1.234,56', '1,001', '1e3', '', 'Infinity', '0.10']) assert.throws(() => money(value));
  assert.throws(() => date('2026-02-30'));
});
test('venda e troco são atômicos e aumentam o total somente pelo valor da venda', () => {
  const day = addMovement(initial(), input({ type: 'sale', amount: 12000, received: 20000 }));
  const s = summary(day);
  assert.equal(s.cash, 120000);
  assert.equal(s.fund, 12000);
  assert.equal(s.total, 132000);
  assert.equal(s.sales, 12000);
  assert.equal(s.missing, 8000);
  assert.equal(s.income, 20000);
  assert.equal(s.expense, 8000);
});
test('exemplo de fundo: 200 -> 120 -> 170 -> 130; transferências não geram receita', () => {
  let day = addMovement(initial(), input({ type: 'sale', amount: 12000, received: 20000 }));
  day = addMovement(day, input({ type: 'replenish', amount: 5000 }));
  assert.equal(summary(day).fund, 17000);
  assert.equal(summary(day).missing, 3000);
  assert.equal(summary(day).total, 132000);
  assert.equal(summary(day).income, 20000);
  day = addMovement(day, input({ type: 'sale', amount: 6000, received: 10000 }));
  assert.equal(summary(day).fund, 13000);
  assert.equal(summary(day).missing, 7000);
});
test('entradas, retiradas, ajustes e excedente do fundo', () => {
  let day = addMovement(initial(), input({ type: 'income', account: 'cash', amount: 1000 }));
  day = addMovement(day, input({ type: 'expense', account: 'cash', amount: 500 }));
  day = addMovement(day, input({ type: 'transfer', from: 'cash', to: 'fund', amount: 2000 }));
  assert.equal(summary(day).excess, 2000);
  assert.equal(summary(day).income, 1000);
  assert.equal(summary(day).expense, 500);
  day = addMovement(day, input({ type: 'adjustment', account: 'fund', direction: 'decrease', amount: 200 }));
  assert.equal(summary(day).adjustments, -200);
  assert.equal(summary(day).total, 120300);
});
test('rejeita valores inválidos, falta de saldo e descrição vazia sem alterar original', () => {
  const day = initial();
  for (const amount of [0, -100, 0.1, NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => addMovement(day, input({ type: 'expense', amount, account: 'cash' })));
  assert.throws(() => addMovement(day, input({ type: 'sale', amount: 1000, received: 30000 })));
  assert.throws(() => addMovement(day, input({ type: 'sale', amount: 2000, received: 1000 })));
  assert.throws(() => addMovement(day, input({ type: 'income', account: 'cash', amount: 1, description: ' ' })));
  assert.throws(() => addMovement(day, input({ type: 'transfer', from: 'fund', to: 'fund', amount: 1 })));
  assert.equal(day.movements.length, 0);
});
test('estorno mantém histórico, inverte venda e impede repetição', () => {
  const sold = addMovement(initial(), input({ type: 'sale', amount: 12000, received: 20000 }));
  const reversed = reverseMovement(sold, sold.movements[0].id, 'Venda cancelada', 'Atendente');
  assert.equal(reversed.movements.length, 2);
  assert.equal(summary(reversed).total, 120000);
  assert.equal(summary(reversed).sales, 0);
  assert.equal(summary(reversed).fund, 20000);
  assert.throws(() => reverseMovement(reversed, sold.movements[0].id, 'Outra', 'Atendente'));
  assert.throws(() => reverseMovement(reversed, reversed.movements[1].id, 'Outra', 'Atendente'));
});
test('fundo pendente de reposição não é diferença de conferência', () => {
  const day = addMovement(initial(), input({ type: 'sale', amount: 12000, received: 20000 }));
  const closed = closeDay(day, { countedCash: 120000, countedFund: 12000, user: 'Atendente' });
  assert.equal(closed.closing.difference, 0);
  assert.equal(closed.closing.expected.missing, 8000);
  assert.throws(() => addMovement(closed, input({ type: 'income', amount: 1, account: 'cash' })));
  assert.throws(() => reverseMovement(closed, day.movements[0].id, 'Correção', 'Atendente'));
  assert.throws(() => closeDay(closed, { countedCash: 0, countedFund: 0, user: 'Atendente' }));
});
test('fechamento registra diferenças por conta, exige justificativa e não ajusta histórico', () => {
  const day = initial();
  assert.throws(() => closeDay(day, { countedCash: 99900, countedFund: 20100, user: 'Atendente' }));
  const closed = closeDay(day, { countedCash: 99900, countedFund: 20100, user: 'Atendente', notes: 'Conferência com valores separados incorretamente' });
  assert.equal(closed.closing.cashDifference, -100);
  assert.equal(closed.closing.fundDifference, 100);
  assert.equal(closed.closing.difference, 0);
  assert.equal(closed.movements.length, 0);
});

test('abertura separa caixa e fundo, usa referência de R$ 100 e impede duplicidade', async () => {
  const { openDay } = await import('../public/domain.js');
  const fields = { date: '2026-11-12', initialCash: 50000, initialFund: 10000, user: 'Atendente' };
  const day = openDay([], fields);
  assert.equal(summary(day).cash, 50000);
  assert.equal(summary(day).fund, 10000);
  assert.equal(summary(day).total, 60000);
  assert.equal(day.referenceFund, 10000);
  assert.throws(() => openDay([day], fields));
  assert.throws(() => openDay([day], { ...fields, date: '2026-11-13' }));
  const closed = closeDay(day, { countedCash: 50000, countedFund: 10000, user: 'Atendente' });
  assert.throws(() => openDay([closed], fields));
  assert.equal(openDay([closed], { ...fields, date: '2026-11-13' }).date, '2026-11-13');
});
