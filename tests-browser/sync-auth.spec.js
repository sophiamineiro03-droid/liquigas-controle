import {test,expect} from '@playwright/test';
function backend(){
 const user={id:'00000000-0000-4000-8000-000000000001',email:'admin@example.invalid',aud:'authenticated',role:'authenticated',created_at:'2026-11-12T00:00:00Z'};
 const unit='00000000-0000-4000-8000-000000000002';let version=0;
 const rows={profiles:[{id:user.id,display_name:'Admin'}],unit_settings:[{unit_id:unit,benefit_price:10798,entity_version:1}],cash_days:[],sales:[],sale_versions:[],deliveries:[],financial_movements:[],movement_entries:[],debt_receipts:[],sale_drafts:[],cash_closings:[],audit_events:[]};
 const applied=new Map(),changes=[];let timeout=false;
 const bump=()=>{version++;changes.push({unit_id:unit,version,change_type:'test',entity_refs:{}});};
 async function route(route){
  const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').at(-1),data=request.postDataJSON();let result;
  if(url.pathname.includes('/auth/v1/token'))result={access_token:'test.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user};
  else if(url.pathname.includes('/auth/v1/user'))result=user;
  else if(url.pathname.includes('/rpc/')){
   if(name==='lc_register_device'){result={id:data.p_device,unit_id:unit,user_id:user.id,manifest_generation:0};bump();}
   else if(name==='lc_publish_queue'){result={accepted:true,generation:data.p_generation};bump();}
   else if(name==='lc_changes')result={changes:changes.filter(c=>c.version>data.p_after),cursor:version,hasMore:false};
   else if(name==='lc_apply_operation'){
    if(applied.has(data.p_operation))result=applied.get(data.p_operation);
    else {
     const c=data.p_command,p=c.data,now=new Date().toISOString();
     if(c.type==='open_day')rows.cash_days.push({id:p.id,unit_id:unit,business_date:p.date,initial_cash:p.initialCash,initial_fund:p.initialFund,reference_fund:10000,notes:p.notes,opened_by:user.id,created_at:now,status:'open',financial_version:0});
     else if(c.type==='sale_create'){
      rows.sales.push({id:p.id,unit_id:unit,day_id:c.dayId,current_revision:1,entity_version:1,customer:p.sale.customer,address:p.sale.address,notes:p.sale.notes,posted:false,canceled:false,created_by:user.id,created_at:now});
      rows.sale_versions.push({unit_id:unit,sale_id:p.id,revision:1,movement_id:p.movementId,original_document:p.sale});
      rows.deliveries.push({id:crypto.randomUUID(),unit_id:unit,sale_id:p.id,driver:p.sale.delivery.driver,driver_other:p.sale.delivery.driverOther,status:p.sale.delivery.status});
      rows.financial_movements.push({id:p.movementId,unit_id:unit,day_id:c.dayId,type:'operationalSale',description:'Venda',actor_id:user.id,sale_id:p.id,created_at:now});
      rows.movement_entries.push({id:crypto.randomUUID(),unit_id:unit,movement_id:p.movementId,line_no:1,from_account:'external',to_account:'cash',amount:12000,kind:'saleReceipt'});
     }else throw new Error('Unexpected '+c.type);
     bump();result={operationId:data.p_operation,serverVersion:version,result:{}};applied.set(data.p_operation,result);
     if(c.type==='sale_create'&&timeout){timeout=false;await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({message:'Network timeout'})});return;}
    }
   }
  }else if(name==='operating_units')result={id:unit,change_version:version};
  else if(name==='unit_memberships')result=[{unit_id:unit,user_id:user.id,role:'admin',active:true}];
  else result=rows[name]??[];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 }
 return {route,rows,applied,timeoutNextSale(){timeout=true;}};
}
async function connect(page){
 await page.goto('/');await page.locator('#sync-account summary').click();
 await page.locator('#account-email').fill('admin@example.invalid');await page.locator('#account-password').fill('senha-de-teste');
 await page.getByRole('button',{name:'Entrar e manter conectado'}).click();
 await page.locator('#activate-connect').click();await expect(page.locator('#sync-detail')).toContainText('Sem pendências');
}
test('dois aparelhos compartilham venda offline e timeout não duplica envio',async({browser})=>{
 const api=backend(),a=await browser.newContext(),b=await browser.newContext();
 for(const context of [a,b])await context.route('https://zvfqqxrkrrneqxuypioj.supabase.co/**',route=>api.route(route));
 const pc=await a.newPage(),phone=await b.newPage();await connect(pc);
 await pc.getByRole('button',{name:'Abrir caixa',exact:true}).click();
 await pc.getByLabel('Caixa inicial — fora do fundo (R$)',{exact:true}).fill('500,00');await pc.getByLabel('Responsável',{exact:true}).fill('Admin');
 await pc.locator('#submit').click();await expect(pc.locator('dialog')).not.toBeVisible();await expect(pc.locator('#sync-detail')).toContainText('Sem pendências');
 await connect(phone);await expect(phone.locator('#current')).toContainText('Caixa aberto');
 await a.setOffline(true);
 await pc.getByRole('button',{name:'Nova venda',exact:true}).click();await pc.getByLabel('Nome do cliente',{exact:true}).fill('Maria');
 await pc.getByLabel('Total da linha (R$)',{exact:true}).fill('120,00');await pc.getByLabel('Forma de pagamento',{exact:true}).selectOption('cash');
 await pc.getByRole('button',{name:'Confirmar venda',exact:true}).click();await expect(pc.locator('dialog')).not.toBeVisible();
 const offline=await pc.evaluate(async()=>(await import('/storage.js')).load());expect(offline.remote.queue).toHaveLength(1);expect(api.rows.sales).toHaveLength(0);
 api.timeoutNextSale();await a.setOffline(false);await pc.locator('#sync-now').click();
 await expect.poll(()=>api.rows.sales.length).toBe(1);await pc.locator('#sync-now').click();
 await expect(pc.locator('#sync-detail')).toContainText('Sem pendências',{timeout:15000});
 await phone.locator('#sync-now').click();await expect(phone.locator('#current')).toContainText('Maria');
 expect(api.rows.sales).toHaveLength(1);expect(api.rows.sales[0].id).toBe(offline.business.sales[0].id);
 const result=await phone.evaluate(async()=>(await import('/storage.js')).load());expect(result.business.sales[0].id).toBe(offline.business.sales[0].id);
 expect(result.days[0].movements).toHaveLength(1);expect(result.days[0].movements[0].syncStatus).toBe('confirmed');
 await a.close();await b.close();
});
