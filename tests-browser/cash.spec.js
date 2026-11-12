import { test, expect } from '@playwright/test';

async function opening(page, cash = '500,00') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
  await page.getByLabel('Caixa inicial — fora do fundo (R$)').fill(cash);
  await page.getByLabel('Responsável', { exact: true }).fill('Atendente');
  await page.getByRole('button', { name: 'Confirmar e salvar', exact: true }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
}
async function sale(page) {
  await page.getByRole('button', { name: 'Venda em espécie', exact: true }).click();
  await page.getByLabel('Valor da venda (R$)').fill('120,00');
  await page.getByLabel('Valor recebido do cliente (R$)').fill('200,00');
  await page.getByLabel('Descrição / motivo').fill('Venda com troco');
  await page.getByLabel('Responsável', { exact: true }).fill('Atendente');
  await expect(page.locator('#change-preview')).toContainText('80,00');
  await page.getByRole('button', { name: 'Confirmar e salvar', exact: true }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
}
async function localState(page) { return page.evaluate(async () => (await import('/storage.js')).load()); }

test('abertura, venda, reposição, conferência, histórico e exportação', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await opening(page);
  await sale(page);
  let state = await localState(page);
  expect(state.days[0].initialCash).toBe(50000);
  expect(state.days[0].referenceFund).toBe(10000);
  expect(state.days[0].movements[0].entries).toHaveLength(2);
  await expect(page.locator('.fund')).toContainText('80,00');
  await page.getByRole('button', { name: 'Repor fundo', exact: true }).click();
  await page.getByLabel('Valor a repor (R$)').fill('50,00');
  await page.getByLabel('Descrição / motivo').fill('Notas menores disponíveis');
  await page.getByRole('button', { name: 'Confirmar e salvar', exact: true }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('.fund')).toContainText('70,00');
  await expect(page.locator('.fund')).toContainText('30,00');
  await page.reload();
  await expect(page.locator('#current')).toContainText('Notas menores disponíveis');
  await page.getByRole('button', { name: 'Conferir e fechar caixa' }).click();
  await page.getByLabel('Caixa contado — fora do fundo (R$)').fill('650,00');
  await page.getByLabel('Fundo de troco contado (R$)').fill('70,00');
  await page.getByLabel('Responsável', { exact: true }).fill('Atendente');
  await expect(page.locator('#closing-preview')).toContainText('Diferença total: R$');
  await page.getByRole('button', { name: 'Confirmar fechamento', exact: true }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  state = await localState(page);
  expect(state.days[0].closing.difference).toBe(0);
  expect(state.days[0].closing.expected.missing).toBe(3000);
  expect(state.days[0].closing.expected.sales).toBe(12000);
  expect(state.days[0].closing.expected.income).toBe(20000);
  await expect(page.locator('#history-detail')).toContainText('Fechamento');
  await expect(page.getByRole('button', { name: 'Imprimir resumo e histórico' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar cópia dos dados' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let data = ''; for await (const chunk of stream) data += chunk.toString();
  const exported = JSON.parse(data);
  expect(exported.days[0].closing.difference).toBe(0);
  expect(exported.days[0].movements).toHaveLength(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/liquigas-desktop.png', fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).not.toBeVisible();
  await expect(page.locator('#history-detail')).toBeVisible();
  const pdf = await page.pdf({ path: '/tmp/liquigas-fechamento.pdf', format: 'A4' });
  expect(pdf.byteLength).toBeGreaterThan(1000);
});

test('offline: recarrega, registra, mantém pendência e preserva após reconectar', async ({ page, context }) => {
  await opening(page);
  await expect(page.locator('#offline-ready')).toContainText('disponível offline');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#connection')).toContainText('Offline');
  await sale(page);
  await page.reload();
  await expect(page.locator('#current')).toContainText('Venda com troco');
  expect((await localState(page)).days[0].movements).toHaveLength(1);
  await context.setOffline(false);
  await expect(page.locator('#connection')).toContainText('Conexão detectada');
  await expect(page.locator('#sync')).toContainText('envio automático ainda não ativado');
  const state = await localState(page);
  expect(state.days[0].movements).toHaveLength(1);
  expect(state.days[0].movements[0].syncStatus).toBe('pending');
});

test('estorno rastreável e validação de saldo insuficiente', async ({ page }) => {
  await opening(page);
  await page.getByRole('button', { name: 'Saída', exact: true }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('9999,00');
  await page.getByLabel('Descrição / motivo').fill('Retirada inválida');
  await page.getByRole('button', { name: 'Confirmar e salvar' }).click();
  await expect(page.locator('#modal-error')).not.toBeEmpty();
  expect((await localState(page)).days[0].movements).toHaveLength(0);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await sale(page);
  await page.getByRole('button', { name: 'Estornar', exact: true }).click();
  await page.getByLabel('Descrição / motivo').fill('Cliente desistiu da venda');
  await page.locator('#submit').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const state = await localState(page);
  expect(state.days[0].movements).toHaveLength(2);
  expect(state.days[0].movements[1].reverses).toBe(state.days[0].movements[0].id);
  await expect(page.getByRole('button', { name: 'Estornar', exact: true })).toHaveCount(0);
});

test('persistência rejeita revisão desatualizada de outra aba', async ({ page, context }) => {
  await opening(page);
  const other = await context.newPage(); await other.goto('/');
  const stale = await localState(other);
  await sale(page);
  const result = await other.evaluate(async stale => {
    const storage = await import('/storage.js');
    try { await storage.save(stale, stale.revision); return 'sobrescreveu'; }
    catch (error) { return error.message; }
  }, stale);
  expect(result).toContain('outra aba');
  expect((await localState(other)).days[0].movements).toHaveLength(1);
});

test('layout de celular e descrição tratada como texto', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await opening(page);
  await page.getByRole('button', { name: 'Entrada', exact: true }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('1,00');
  await page.getByLabel('Descrição / motivo').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Confirmar e salvar' }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('#current')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('main img').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/liquigas-mobile.png', fullPage: true });
});

test('erro de armazenamento não cria falsa confirmação', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const storage = await import('/storage.js');
    const db = await storage.database();
    db.close();
  });
  await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
  await page.getByLabel('Caixa inicial — fora do fundo (R$)').fill('500,00');
  await page.getByLabel('Responsável', { exact: true }).fill('Atendente');
  await page.getByRole('button', { name: 'Confirmar e salvar' }).click();
  await expect(page.locator('#modal-error')).not.toBeEmpty();
  await expect(page.locator('dialog')).toBeVisible();
});

test('formulário aberto em outra aba exige nova conferência antes de salvar', async ({ page, context }) => {
  await opening(page);
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button', { name: 'Saída', exact: true }).click();
  await other.getByLabel('Valor (R$)', { exact: true }).fill('10,00');
  await other.getByLabel('Descrição / motivo').fill('Retirada após alteração concorrente');
  await other.getByLabel('Responsável', { exact: true }).fill('Outra atendente');
  await sale(page);
  await expect.poll(() => other.locator('#sync').textContent()).toContain('2 registros');
  await other.getByRole('button', { name: 'Confirmar e salvar' }).click();
  await expect(other.locator('#modal-error')).toContainText('Feche e reabra');
  expect((await localState(other)).days[0].movements).toHaveLength(1);
});

test('clique duplo não duplica movimentação', async ({ page }) => {
  await opening(page);
  await page.getByRole('button', { name: 'Entrada', exact: true }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('10,00');
  await page.getByLabel('Descrição / motivo').fill('Aporte único');
  await page.locator('#submit').evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('dialog')).not.toBeVisible();
  expect((await localState(page)).days[0].movements).toHaveLength(1);
});
