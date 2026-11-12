import {test,expect} from '@playwright/test';
const read=page=>page.evaluate(async()=> (await import('/storage.js')).load());
async function openCash(page){
 await page.goto('/');await page.getByRole('button',{name:'Abrir caixa',exact:true}).click();
 await page.getByLabel('Caixa inicial — fora do fundo (R$)').fill('0');await page.getByLabel('Responsável',{exact:true}).fill('Sophia');await page.locator('#submit').click();
 await expect(page.locator('dialog')).not.toBeVisible();
}
test('salva o caso da imagem sem valor obrigatório, reabre e confirma preservando o UUID',async({page})=>{
 await openCash(page);await page.getByRole('button',{name:'Nova venda',exact:true}).click();
 await page.getByLabel('Nome do cliente',{exact:true}).fill('lala');
 await expect(page.getByLabel('Forma de pagamento',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Salvar anotação',exact:true}).click();
 await expect(page.locator('dialog')).not.toBeVisible();await expect(page.locator('#sales-list')).toContainText('lala');
 let s=await read(page);const id=s.business.drafts[0].id;
 expect(s.business.sales).toHaveLength(0);expect(s.days[0].movements).toHaveLength(0);
 await page.reload();await page.getByRole('button',{name:'Vendas',exact:true}).click();
 await page.getByRole('button',{name:'Completar / editar anotação'}).click();
 await expect(page.getByLabel('Nome do cliente',{exact:true})).toHaveValue('lala');
 await page.getByLabel('Total da linha (R$)',{exact:true}).fill('120,00');
 await page.getByLabel('Forma de pagamento',{exact:true}).selectOption('pix');
 await page.getByRole('button',{name:'Confirmar venda',exact:true}).click();
 await expect(page.locator('dialog')).not.toBeVisible();s=await read(page);
 expect(s.business.sales[0].id).toBe(id);expect(s.business.drafts[0].status).toBe('converted');
 expect(s.business.sales[0].payments[0].method).toBe('pix');expect(s.days[0].movements[0].entries).toHaveLength(0);
});
test('pode anotar tudo em branco antes de abrir caixa e arquivar sem excluir',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Nova anotação',exact:true}).click();
 await page.getByRole('button',{name:'Salvar anotação',exact:true}).click();
 await expect(page.locator('dialog')).not.toBeVisible();expect((await read(page)).business.drafts).toHaveLength(1);
 await page.getByRole('button',{name:'Arquivar anotação',exact:true}).click();await page.locator('#submit').click();
 await expect(page.locator('dialog')).not.toBeVisible();expect((await read(page)).business.drafts[0].status).toBe('canceled');
});
test('anotação offline preserva valor e pagamento desconhecidos',async({page,context})=>{
 await openCash(page);await expect(page.locator('#offline-ready')).toContainText('disponível offline');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller) await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
 await context.setOffline(true);await page.reload();await page.getByRole('button',{name:'Nova venda',exact:true}).click();
 await page.locator('#sale-extras summary').click();await page.getByLabel('Observações da venda',{exact:true}).fill('Entregar, perguntar quem vai e como vai pagar');
 await page.getByRole('button',{name:'Salvar anotação',exact:true}).click();await expect(page.locator('dialog')).not.toBeVisible();
 await page.reload();const s=await read(page);expect(s.business.sales).toHaveLength(0);expect(s.business.drafts[0].document.fields.simpleMethod).toBe('');
 await page.getByRole('button',{name:'Vendas',exact:true}).click();await expect(page.locator('#sales-list')).toContainText('perguntar quem vai');
});
