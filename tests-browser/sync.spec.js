import {test,expect} from '@playwright/test';
const ledger=page=>page.evaluate(async()=>(await import('/storage.js')).load());
async function enableOffline(page,context){
 await page.goto('/');await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();
 await page.evaluate(async()=>{const {updateStored}=await import('/storage.js');await updateStored(s=>{s.remote={enabled:true,unitId:'unit',userId:'admin',deviceId:'device',queue:[],generation:0,cursor:0,hydrated:true};return s;});});
 await context.setOffline(true);await page.reload();
}
test('operação e fila persistem atomicamente offline e conservam IDs ao recarregar',async({page,context})=>{
 await enableOffline(page,context);
 await page.getByRole('button',{name:'Abrir caixa',exact:true}).click();
 await page.getByLabel('Caixa inicial — fora do fundo (R$)',{exact:true}).fill('500,00');
 await page.getByLabel('Responsável',{exact:true}).fill('Admin');
 await page.locator('#submit').click();await expect(page.locator('dialog')).not.toBeVisible();
 const before=await ledger(page);expect(before.remote.queue).toHaveLength(1);
 expect(before.remote.queue[0].command.type).toBe('open_day');expect(before.remote.queue[0].command.data.id).toBe(before.days[0].id);
 await page.reload();const after=await ledger(page);expect(after.remote.queue).toEqual(before.remote.queue);expect(after.days).toEqual(before.days);
 await expect(page.locator('#sync')).toContainText('1 operações pendentes');
});
test('falha na preparação da fila aborta também gravação do lançamento',async({page,context})=>{
 await enableOffline(page,context);
 await page.evaluate(async()=>{const {updateStored}=await import('/storage.js');await updateStored(s=>{s.remote.importing=true;return s;});});await page.reload();
 await page.getByRole('button',{name:'Abrir caixa',exact:true}).click();
 await page.getByLabel('Caixa inicial — fora do fundo (R$)',{exact:true}).fill('100,00');
 await page.getByLabel('Responsável',{exact:true}).fill('Admin');await page.locator('#submit').click();
 await expect(page.locator('#modal-error')).toContainText('importação');
 const state=await ledger(page);expect(state.days).toHaveLength(0);expect(state.remote.queue).toHaveLength(0);
});
test('sem sessão não há falsa confirmação remota nem envio de senha no ledger',async({page})=>{
 const requests=[];page.on('request',r=>{if(r.url().includes('/rest/v1/'))requests.push(r.url());});
 await page.goto('/');await page.locator('#sync-account summary').click();
 await expect(page.locator('#remote-login')).toBeVisible();
 await expect(page.locator('#sync-detail')).toContainText('Entre na sua conta');
 expect((await ledger(page)).remote).toBeUndefined();expect(requests).toEqual([]);
});
