import { test, expect } from '@playwright/test';
async function opening(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
  await page.getByLabel('Caixa inicial — fora do fundo (R$)').fill('500,00');
  await page.getByLabel('Responsável', { exact: true }).fill('Sophia');
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
}
async function newSale(page) {
  await page.getByRole('button', { name: 'Nova venda', exact: true }).click();
  await page.getByLabel('Nome do cliente', { exact: true }).fill('Maria');
  await page.getByLabel('Total da linha (R$)', { exact: true }).fill('120,00');
}
const data = page => page.evaluate(async () => (await import('/storage.js')).load());

test('venda comum exige só cliente e total; pagamento e atendente já estão preenchidos', async ({ page }) => {
  await opening(page); await page.reload(); await newSale(page);
  await expect(page.getByLabel('Quantidade', { exact: true })).toHaveValue('1');
  await expect(page.locator('#sale-totals')).toContainText('120,00');
  await expect(page.locator('#payment-summary')).toContainText('120,00 em Dinheiro');
  await expect(page.locator('#split-fields')).not.toBeVisible();
  await expect(page.getByLabel('Nome do entregador', { exact: true })).not.toBeVisible();
  await expect(page.locator('#sale-recorder')).toContainText('Sophia');
  await expect(page.getByLabel('Retirar troco de', { exact: true })).not.toBeVisible();
  const saveButton = page.getByRole('button', { name: 'Registrar venda', exact: true });
  await expect(saveButton).toBeInViewport();
  await page.locator('#modal').screenshot({ path: '/tmp/liquigas-formulario-simples.png' });
  await page.getByRole('button', { name: 'Registrar venda', exact: true }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const sale = (await data(page)).business.sales[0];
  expect(sale.user).toBe('Sophia'); expect(sale.items[0].quantity).toBe(1);
  expect(sale.payments).toEqual([{ category: 'gas', method: 'cash', amount: 12000 }]);
  expect(sale.posted).toBe(false);
});

test('um único Pix paga gás e água sem digitar o valor recebido de novo', async ({ page }) => {
  await opening(page); await newSale(page);
  await page.getByRole('button', { name: 'Adicionar produto' }).click();
  await page.locator('.item-row').nth(1).getByLabel('Produto', { exact: true }).selectOption('water20');
  await page.locator('.item-row').nth(1).getByLabel('Total da linha (R$)').fill('10,00');
  await page.getByLabel('Forma de pagamento', { exact: true }).selectOption('pix');
  await expect(page.locator('#cash-fields')).not.toBeVisible();
  await expect(page.locator('#payment-summary')).toContainText('Gás:');
  await expect(page.locator('#payment-summary')).toContainText('Água:');
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const stored = await data(page);
  expect(stored.business.sales[0].payments).toEqual([{category:'gas',method:'pix',amount:12000},{category:'water',method:'pix',amount:1000}]);
  expect(stored.days[0].movements[0].entries).toEqual([]);
});

test('troco aparece só com dinheiro e não fica registrado ao trocar para cartão', async ({ page }) => {
  await opening(page); await newSale(page);
  await page.getByLabel('Cliente entregou em dinheiro (R$)').fill('150,00');
  await expect(page.locator('#order-change')).toContainText('30,00');
  await expect(page.getByLabel('Retirar troco de', { exact: true })).toBeVisible();
  await page.getByLabel('Forma de pagamento', { exact: true }).selectOption('debit');
  await expect(page.locator('#cash-fields')).not.toBeVisible();
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const sale = (await data(page)).business.sales[0];
  expect(sale.tendered).toBe(0); expect(sale.change).toBe(0); expect(sale.payments[0].method).toBe('debit');
});

test('divisão manual continua explícita e valores não são sobrescritos ao editar o total', async ({ page }) => {
  await opening(page); await newSale(page);
  await page.getByLabel('Dividir pagamento', { exact: true }).check();
  await page.locator('.payment-row').first().getByLabel('Valor (R$)').fill('50,00');
  await page.getByRole('button', { name: 'Adicionar outra forma' }).click();
  await page.locator('.payment-row').nth(1).getByLabel('Valor (R$)').fill('70,00');
  await expect(page.locator('#allocation-summary')).toContainText('conferido');
  await page.getByLabel('Total da linha (R$)').fill('130,00');
  await expect(page.locator('.payment-row').first().getByLabel('Valor (R$)')).toHaveValue('50,00');
  await expect(page.locator('#allocation-summary')).toContainText('10,00');
  await page.locator('#submit').click();
  await expect(page.locator('#modal-error')).toContainText('devem somar exatamente');
  expect((await data(page)).business.sales).toHaveLength(0);
  await page.locator('.payment-row').nth(1).getByLabel('Valor (R$)').fill('80,00');
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  expect((await data(page)).business.sales[0].payments.map(p => p.amount)).toEqual([5000,8000]);
});

test('entregador define opções de situação, sem presumir entrega realizada', async ({ page }) => {
  await opening(page); await newSale(page);
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('pickup');
  await page.getByLabel('Quem entrega / retirada no local', { exact: true }).selectOption('Wagner');
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('awaiting');
  await expect(page.getByLabel('Nome do entregador', { exact: true })).not.toBeVisible();
  await page.getByLabel('Quem entrega / retirada no local', { exact: true }).selectOption('Outro');
  await expect(page.getByLabel('Nome do entregador', { exact: true })).toBeVisible();
  await page.getByLabel('Nome do entregador', { exact: true }).fill('Entregador extra');
  await page.getByLabel('Quem entrega / retirada no local', { exact: true }).selectOption('Depósito');
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('pickup');
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const sale = (await data(page)).business.sales[0];
  expect(sale.delivery.driverOther).toBe(''); expect(sale.delivery.status).toBe('pickup');
});

test('benefício preenche o preço e esconde controles de pagamento que não se aplicam', async ({ page }) => {
  await opening(page);
  await page.getByRole('button', { name: 'Nova venda', exact: true }).click();
  await page.getByLabel('Nome do cliente', { exact: true }).fill('Ana');
  await page.getByLabel('Quantidade', { exact: true }).fill('2');
  await page.getByLabel('Gás do Povo', { exact: true }).check();
  await expect(page.getByLabel('Total da linha (R$)')).toHaveValue('215,96');
  await expect(page.locator('#normal-payments')).not.toBeVisible();
  await expect(page.locator('#cash-fields')).not.toBeVisible();
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  expect((await data(page)).business.sales[0].payments).toEqual([{category:'gas',method:'benefit',amount:21596}]);
});

test('formulário rápido cabe no celular e preserva dados opcionais', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await opening(page); await newSale(page);
  await page.locator('#sale-extras summary').click();
  await page.getByLabel('Observações da venda', { exact: true }).fill('Retirar à tarde');
  await page.getByLabel('Bairro', { exact: true }).fill('Centro');
  expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#modal').screenshot({path:'/tmp/liquigas-formulario-celular.png'});
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const sale = (await data(page)).business.sales[0];
  expect(sale.address.district).toBe('Centro'); expect(sale.notes).toBe('Retirar à tarde');
});
