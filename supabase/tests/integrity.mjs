import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {openDay,summary,addMovement} from '../../public/domain.js';
import {prepareState,createSale,report as jsReport} from '../../public/commerce.js';
const q = value => `'${String(value).replaceAll("'","''")}'`;
const arg = value => value===null?'null':typeof value==='object'?`${q(JSON.stringify(value))}::jsonb`:typeof value==='number'?String(value):q(value);
export async function run({sql,sqlAsync}) {
 let passed=0,failed=0;
 const admin=id(),stranger=id(),viewer=id(),operator=id();
 const as=(user,statement,role='authenticated')=>`begin; set local role ${role}; set local "request.jwt.claim.sub"=${q(user??'')}; ${statement}; commit;`;
 const parse=s=>JSON.parse(s);
 const call=(user,name,args,role='authenticated')=>parse(sql(as(user,`select public.${name}(${args.map(arg).join(',')})`,role)));
 const callAsync=(user,name,args)=>sqlAsync(as(user,`select public.${name}(${args.map(arg).join(',')})`)).then(parse);
 const read=(user,query)=>sql(as(user,query));
 const rejects=(fn,pattern)=>assert.throws(fn,pattern);
 async function test(name,fn) {
  try{await fn();passed++;console.log(`PASS ${name}`);}catch(e){failed++;console.error(`FAIL ${name}\n${e.stack}`);}
 }
 sql(`insert into auth.users(id,email,email_confirmed_at) values (${q(admin)},'admin@example.invalid',now()),(${q(stranger)},'stranger@example.invalid',now()),(${q(viewer)},'viewer@example.invalid',now()),(${q(operator)},'operator@example.invalid',now());`);
 await test('bootstrap exige usuário confirmado e email esperado; API não pode chamar bootstrap',()=>{
  rejects(()=>sql(`select private.bootstrap_admin(${q(admin)},${q(id())},'outro@example.invalid','Admin','Unidade');`),/LC_CONFIRMED_AUTH_USER_REQUIRED/);
  rejects(()=>sql(as(admin,`select private.bootstrap_admin(${q(admin)},${q(id())},'admin@example.invalid','Admin','Unidade')`)),/permission denied/);
  const unit=id();assert.equal(sql(`select private.bootstrap_admin(${q(admin)},${q(unit)},'admin@example.invalid','Admin','Liquigás');`),unit);
  rejects(()=>sql(`select private.bootstrap_admin(${q(stranger)},${q(id())},'stranger@example.invalid','Outro','Outra');`),/LC_ALREADY_BOOTSTRAPPED/);
 });
 sql(`insert into public.profiles(id,display_name) values (${q(stranger)},'Estranha'),(${q(viewer)},'Leitora'),(${q(operator)},'Operadora');`);
 function fixture({cash=50000,fund=10000,open=true}={}) {
  const f={unit:id(),day:id(),device:id(),generation:0,pending:new Map()};
  sql(`insert into public.operating_units(id,name) values (${q(f.unit)},'Teste isolado');insert into public.unit_memberships(unit_id,user_id,role) values (${q(f.unit)},${q(admin)},'admin');insert into public.unit_settings(unit_id) values (${q(f.unit)});`);
  call(admin,'lc_register_device',[f.unit,f.device,'Computador']);
  f.publish=()=>call(admin,'lc_publish_queue',[f.unit,f.device,++f.generation,[...f.pending].map(([id,command])=>({id,command}))]);
  f.enqueue=(command,op=id())=>{f.pending.set(op,command);f.publish();return op;};
  f.apply=(command,op)=>{const result=call(admin,'lc_apply_operation',[f.unit,f.device,op,command]);f.pending.delete(op);return result;};
  f.op=(type,data,day=f.day)=>{const command={type,dayId:day,data};if(type.startsWith('close_')) return call(admin,'lc_apply_operation',[f.unit,f.device,id(),command]);const op=f.enqueue(command);return f.apply(command,op);};
  f.discard=op=>{call(admin,'lc_discard_pending',[f.unit,f.device,op,'Descartada explicitamente no teste']);f.pending.delete(op);f.generation++;};
  f.report=()=>call(admin,'lc_day_report',[f.unit,f.day]);
  f.sale=(body=saleBody(),saleId=id())=>{f.op('sale_create',{id:saleId,sale:body});return saleId;};
  if(open) f.op('open_day',{id:f.day,date:'2026-11-12',initialCash:cash,initialFund:fund});
  return f;
 }
 function saleBody(extra={}) {return {customer:'Maria',items:[{product:'p13',quantity:1,total:12000,benefit:false}],payments:[{category:'gas',method:'cash',amount:12000}],delivery:{driver:'Depósito',status:'pickup'},posted:false,...extra};}
 function newDevice(f) {const d=id();call(admin,'lc_register_device',[f.unit,d,'Celular']);call(admin,'lc_publish_queue',[f.unit,d,1,[]]);return d;}
 function prepare(f) {return f.op('close_prepare',{}).result;}
 function ack(f,roundId,device=f.device,generation=f.generation) {return call(admin,'lc_apply_operation',[f.unit,device,id(),{type:'close_ack',dayId:f.day,data:{roundId,manifestGeneration:generation}}]);}
 function close(f,prepared,extra={}) {const r=f.report();return f.op('close_commit',{id:id(),roundId:prepared.roundId,financialVersion:prepared.financialVersion,countedCash:r.physical.cash,countedFund:r.physical.fund,...extra});}

 await test('RLS nega anônimo, conta sem autorização, outra unidade e associação inativa',()=>{
  const f=fixture();
  rejects(()=>call(null,'lc_day_report',[f.unit,f.day],'anon'),/permission denied/);
  rejects(()=>sql(as(null,'select * from public.sales','anon')),/permission denied/);
  assert.equal(read(stranger,'select count(*) from public.cash_days'),'0');
  rejects(()=>call(stranger,'lc_day_report',[f.unit,f.day]),/LC_PERMISSION_DENIED/);
  sql(`update public.unit_memberships set active=false where unit_id=${q(f.unit)};`);
  assert.equal(read(admin,`select count(*) from public.cash_days where unit_id=${q(f.unit)}`),'0');
  rejects(()=>call(admin,'lc_day_report',[f.unit,f.day]),/LC_PERMISSION_DENIED/);
 });
 await test('nem administradora pode gravar tabelas diretamente ou executar auxiliares privados',()=>{
  const f=fixture();
  for(const table of ['cash_days','sales','financial_movements','payment_allocations','audit_events','unit_memberships','devices','sync_operations']) {
   rejects(()=>sql(as(admin,`delete from public.${table}`)),/permission denied/);
  }
  rejects(()=>sql(as(admin,`select private.normalize_sale('{}',10798)`)),/permission denied/);
  assert.equal(read(admin,`select count(*) from public.cash_days where unit_id=${q(f.unit)}`),'1');
 });
 await test('papéis futuros: viewer só lê; operator não altera preço nem fecha caixa',()=>{
  const f=fixture();sql(`insert into public.unit_memberships(unit_id,user_id,role) values (${q(f.unit)},${q(viewer)},'viewer'),(${q(f.unit)},${q(operator)},'operator');`);
  assert.equal(call(viewer,'lc_day_report',[f.unit,f.day]).physical.total,60000);
  rejects(()=>call(viewer,'lc_register_device',[f.unit,id(),'Leitor']),/LC_PERMISSION_DENIED/);
  const dev=id();call(operator,'lc_register_device',[f.unit,dev,'Operadora']);
  rejects(()=>call(operator,'lc_apply_operation',[f.unit,dev,id(),{type:'close_prepare',dayId:f.day,data:{}}]),/LC_PERMISSION_DENIED/);
  rejects(()=>call(operator,'lc_apply_operation',[f.unit,dev,id(),{type:'benefit_price',data:{amount:1,expectedVersion:1}}]),/LC_PERMISSION_DENIED/);
 });
 await test('UUID de dispositivo não pode ser apropriado por outro usuário',()=>{
  const f=fixture();sql(`insert into public.unit_memberships values (${q(f.unit)},${q(operator)},'operator',true,now());`);
  rejects(()=>call(operator,'lc_register_device',[f.unit,f.device,'Roubo']),/LC_DEVICE_NOT_AUTHORIZED/);
 });
 await test('abertura separa caixa/fundo e impede duplicidade ou segundo caixa aberto',()=>{
  const f=fixture();assert.deepEqual(f.report().physical,{cash:50000,fund:10000,total:60000,income:0,expense:0,sales:0,transfers:0,adjustments:0,missing:0,excess:0});
  rejects(()=>f.op('open_day',{id:id(),date:'2026-11-12',initialCash:0,initialFund:10000},id()),/LC_DAY_ID_MISMATCH/);
  const other=id();rejects(()=>f.op('open_day',{id:other,date:'2026-11-12',initialCash:0,initialFund:10000},other),/duplicate key/);
  const another=id();rejects(()=>f.op('open_day',{id:another,date:'2026-11-13',initialCash:0,initialFund:10000},another),/duplicate key/);
 });
 await test('idempotência: mesma operação retorna resposta idêntica sem repetir venda ou auditoria',()=>{
  const f=fixture();const command={type:'sale_create',dayId:f.day,data:{id:id(),movementId:id(),sale:saleBody()}};const op=f.enqueue(command);
  const first=f.apply(command,op);const before=sql(`select count(*) from public.audit_events where unit_id=${q(f.unit)};`);
  assert.deepEqual(f.apply(command,op),first);
  assert.equal(sql(`select count(*) from public.audit_events where unit_id=${q(f.unit)};`),before);
  assert.equal(sql(`select count(*) from public.sales where unit_id=${q(f.unit)};`),'1');
  rejects(()=>f.apply({...command,data:{...command.data,sale:saleBody({customer:'Outra'})}},op),/LC_OPERATION_PAYLOAD_CONFLICT/);
 });
 await test('UUID da venda impede duplicação mesmo com outro ID de operação',()=>{
  const f=fixture();const saleId=f.sale();rejects(()=>f.op('sale_create',{id:saleId,sale:saleBody()}),/duplicate key/);
  assert.equal(f.report().sales,12000);
 });
 await test('operação financeira sem manifesto é rejeitada; manifesto não pode sumir com pendências',()=>{
  const f=fixture();const cmd={type:'movement',dayId:f.day,data:{id:id(),type:'income',amount:100,account:'cash',description:'Aporte'}};
  rejects(()=>f.apply(cmd,id()),/LC_MANIFEST_OPERATION_REQUIRED/);
  const op=f.enqueue(cmd);rejects(()=>call(admin,'lc_publish_queue',[f.unit,f.device,f.generation+1,[]]),/LC_CANNOT_OMIT_PENDING_OPERATION/);
  assert.equal(f.report().physical.cash,50000);f.apply(cmd,op);assert.equal(f.report().physical.cash,50100);
 });
 await test('valores fracionários, negativos, excessivos e conta externa em transferência são rejeitados',()=>{
  const f=fixture();for(const amount of [-1,1.1,1000000000000]) rejects(()=>f.op('movement',{id:id(),type:'income',amount,account:'cash',description:'Inválido'}),/LC_INVALID_CENTS/);
  rejects(()=>f.op('movement',{id:id(),type:'transfer',amount:100,from:'external',to:'cash',description:'Inválido'}),/LC_INVALID_TRANSFER/);
 });
 await test('venda/troco: resultado SQL é igual às regras JS existentes',()=>{
  const f=fixture();const body=saleBody({tendered:20000});f.sale(body);
  let js=prepareState({days:[openDay([],{date:'2026-11-12',initialCash:50000,initialFund:10000,user:'Admin'})]});js=createSale(js,body,'Admin');
  const actual=f.report(),expected=jsReport(js,js.days[0].id);
  assert.deepEqual(actual.physical,summary(js.days[0]));
  for(const key of ['categories','payments','quantities','benefitQuantity','sales','received','creditSold','pending']) assert.deepEqual(actual[key],expected[key],key);
 });
 await test('transferência e reposição não são receitas/despesas; saldo negativo reverte a transação inteira',()=>{
  const f=fixture();f.op('movement',{id:id(),type:'transfer',amount:4000,from:'fund',to:'cash',description:'Troco no caixa'});
  assert.equal(f.report().physical.fund,6000);assert.equal(f.report().received,0);assert.equal(f.report().expense,0);
  f.op('movement',{id:id(),type:'replenish',amount:4000,description:'Notas menores'});
  const before=f.report();rejects(()=>f.op('movement',{id:id(),type:'expense',amount:999999,account:'cash',description:'Sem saldo'}),/LC_INSUFFICIENT_FUNDS/);
  assert.deepEqual(f.report(),before);
 });
 await test('Pix, cartões e fiado não criam dinheiro físico',()=>{
  for(const method of ['pix','debit','credit','creditSale']) {const f=fixture();f.sale(saleBody({payments:[{category:'gas',method,amount:12000}]}));assert.equal(f.report().physical.total,60000);assert.equal(f.report().pending,method==='creditSale'?12000:0);}
 });
 await test('gás/água divididos e benefício/taxa correspondem ao relatório JS',()=>{
  const cases=[saleBody({items:[{product:'p13',quantity:2,total:24000},{product:'water20',quantity:3,total:3000}],payments:[{category:'gas',method:'cash',amount:10000},{category:'gas',method:'pix',amount:14000},{category:'water',method:'debit',amount:3000}]}),saleBody({items:[{product:'p13',quantity:1,total:10798,benefit:true}],payments:[{category:'gas',method:'benefit',amount:10798}],fee:{amount:1000,method:'cash',status:'paid'},delivery:{driver:'Wagner',status:'awaiting'}})];
  for(const body of cases) {const f=fixture();f.sale(body);let js=prepareState({days:[openDay([],{date:'2026-11-12',initialCash:50000,initialFund:10000,user:'Admin'})]});js=createSale(js,body,'Admin');const r=jsReport(js,js.days[0].id);for(const k of ['categories','payments','quantities','benefitQuantity','sales','received','pending','physical']) assert.deepEqual(f.report()[k],r[k],k);}
 });
 await test('categoria, valor do benefício, quantidade e soma de parcelas inválidos não deixam venda parcial',()=>{
  const f=fixture();for(const body of [saleBody({payments:[{category:'water',method:'cash',amount:12000}]}),saleBody({items:[{product:'p13',quantity:1,total:12000,benefit:true}],payments:[{category:'gas',method:'benefit',amount:12000}]}),saleBody({items:[{product:'water20',quantity:1.5,total:12000}]})]) rejects(()=>f.sale(body),/LC_/);
  assert.equal(sql(`select count(*) from public.sales where unit_id=${q(f.unit)}`),'0');
 });
 await test('taxa pendente e recebimento parcial não repetem vendas',()=>{
  const f=fixture();const sale=f.sale(saleBody({items:[{product:'p13',quantity:1,total:10798,benefit:true}],payments:[{category:'gas',method:'benefit',amount:10798}],fee:{amount:1000,method:'cash',status:'pending'},delivery:{driver:'Vinicius',status:'awaiting'}}));
  f.op('receipt_create',{id:id(),saleId:sale,target:'fee',amount:500,method:'pix'});assert.equal(f.report().sales,11798);assert.equal(f.report().received,11298);assert.equal(f.report().pending,500);assert.equal(f.report().physical.total,60000);
 });
 await test('recebimento acima da dívida é rejeitado e recebimento sem vínculo não inventa saldo',()=>{
  const f=fixture();const sale=f.sale(saleBody({payments:[{category:'gas',method:'creditSale',amount:12000}]}));
  f.op('receipt_create',{id:id(),saleId:sale,target:'gas',amount:6000,method:'pix'});
  rejects(()=>f.op('receipt_create',{id:id(),saleId:sale,target:'gas',amount:6001,method:'cash'}),/LC_OVERPAYMENT/);
  f.op('receipt_create',{id:id(),customer:'Dívida antiga',category:'water',amount:1000,method:'cash'});
  assert.equal(f.report().pending,6000);assert.equal(f.report().sales,12000);assert.equal(f.report().previousDebtReceived,1000);assert.equal(f.report().physical.cash,51000);
 });
 await test('duas sessões não podem receber mais que o saldo devido',async()=>{
  const f=fixture();const dev=newDevice(f);const sale=f.sale(saleBody({payments:[{category:'gas',method:'creditSale',amount:12000}]}));
  const a={type:'receipt_create',dayId:f.day,data:{id:id(),saleId:sale,target:'gas',amount:8000,method:'pix'}};
  const b={...a,data:{...a.data,id:id()}};const opA=f.enqueue(a),opB=id();call(admin,'lc_publish_queue',[f.unit,dev,2,[{id:opB,command:b}]]);
  const results=await Promise.allSettled([callAsync(admin,'lc_apply_operation',[f.unit,f.device,opA,a]),callAsync(admin,'lc_apply_operation',[f.unit,dev,opB,b])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/LC_OVERPAYMENT/);assert.equal(f.report().pending,4000);
 });
 await test('estorno único preserva movimento; movimento comercial só pode ser estornado pela operação correta',()=>{
  const f=fixture();const movement=id();f.op('movement',{id:movement,type:'income',amount:1000,account:'cash',description:'Aporte'});
  f.op('movement_reverse',{id:id(),movementId:movement,reason:'Aporte incorreto'});
  rejects(()=>f.op('movement_reverse',{id:id(),movementId:movement,reason:'Repetição'}),/LC_ALREADY_REVERSED/);
  const sale=f.sale();const mov=sql(`select movement_id from public.sale_versions where unit_id=${q(f.unit)} and sale_id=${q(sale)}`);
  rejects(()=>f.op('movement_reverse',{id:id(),movementId:mov,reason:'Não permitido'}),/LC_INVALID_REVERSAL_TARGET/);
 });
 await test('correção mantém UUID, cria versão e inversão; versão antiga não pode ser adulterada',()=>{
  const f=fixture();const sale=f.sale();f.op('sale_correct',{id:sale,expectedVersion:1,reason:'Pagamento era Pix',sale:saleBody({payments:[{category:'gas',method:'pix',amount:12000}]})});
  assert.equal(sql(`select count(*) from public.sale_versions where unit_id=${q(f.unit)} and sale_id=${q(sale)}`),'2');assert.equal(f.report().physical.total,60000);
  rejects(()=>sql(`update public.sale_versions set cash_amount=1 where unit_id=${q(f.unit)}`),/LC_IMMUTABLE_HISTORY/);
  rejects(()=>f.op('sale_cancel',{id:sale,expectedVersion:1,reason:'Versão obsoleta'}),/LC_ENTITY_VERSION_CONFLICT/);
  f.op('sale_cancel',{id:sale,expectedVersion:2,reason:'Cancelada'});assert.equal(f.report().sales,0);
 });
 await test('correção/cancelamento exige resolver recebimentos ativos primeiro',()=>{
  const f=fixture();const sale=f.sale(saleBody({payments:[{category:'gas',method:'creditSale',amount:12000}]}));const receipt=id();f.op('receipt_create',{id:receipt,saleId:sale,target:'gas',amount:1000,method:'cash'});
  rejects(()=>f.op('sale_cancel',{id:sale,expectedVersion:1,reason:'Cancelar'}),/LC_ACTIVE_RECEIPTS/);
  f.op('receipt_reverse',{id:receipt,expectedVersion:1,reason:'Recebimento incorreto'});assert.equal(f.report().pending,12000);
 });
 await test('preço novo não altera a fotografia financeira antiga',()=>{
  const f=fixture();const old=f.sale(saleBody({items:[{product:'p13',quantity:1,total:10798,benefit:true}],payments:[{category:'gas',method:'benefit',amount:10798}]}));f.op('benefit_price',{amount:11000,expectedVersion:1},null);
  assert.equal(sql(`select benefit_price from public.sale_versions where sale_id=${q(old)}`),'10798');
  f.sale(saleBody({items:[{product:'p13',quantity:1,total:11000,benefit:true}],payments:[{category:'gas',method:'benefit',amount:11000}]}));assert.equal(f.report().benefitQuantity,2);
 });
 await test('fechamento exige rodada, manifesto e confirmação de todos os dispositivos',()=>{
  const f=fixture();const dev=newDevice(f);const p=prepare(f);ack(f,p.roundId);
  rejects(()=>close(f,p),/LC_DEVICES_NOT_ACKNOWLEDGED/);ack(f,p.roundId,dev,1);close(f,p);
  assert.equal(sql(`select status from public.cash_days where id=${q(f.day)}`),'closed');
  rejects(()=>f.op('movement',{id:id(),type:'income',amount:100,account:'cash',description:'Após fechar'}),/LC_CASH_NOT_OPEN/);
 });
 await test('pendências conhecidas bloqueiam fechamento; não são apagadas silenciosamente',()=>{
  const f=fixture();const cmd={type:'movement',dayId:f.day,data:{id:id(),type:'income',amount:100,account:'cash',description:'Pendente'}};const op=f.enqueue(cmd);
  rejects(()=>prepare(f),/LC_PENDING_OPERATIONS/);f.discard(op);f.publish();const p=prepare(f);ack(f,p.roundId);close(f,p);
  assert.equal(sql(`select status from public.device_pending_operations where unit_id=${q(f.unit)} and id=${q(op)}`),'discarded');
 });
 await test('novo manifesto invalida ack da rodada e fechamento exige justificativa de diferença',()=>{
  const f=fixture();const p=prepare(f);ack(f,p.roundId);f.publish();rejects(()=>close(f,p),/LC_DEVICES_NOT_ACKNOWLEDGED/);ack(f,p.roundId);
  rejects(()=>close(f,p,{countedCash:49900}),/check constraint/);
  close(f,p,{countedCash:49900,notes:'Falta de R$1 na conferência'});assert.equal(sql(`select difference from public.cash_closings where day_id=${q(f.day)}`),'-100');
 });
 await test('duas sessões não finalizam o mesmo caixa duas vezes',async()=>{
  const f=fixture();const p=prepare(f);ack(f,p.roundId);
  const command={type:'close_commit',dayId:f.day,data:{id:id(),roundId:p.roundId,financialVersion:p.financialVersion,countedCash:50000,countedFund:10000}};
  const results=await Promise.allSettled([callAsync(admin,'lc_apply_operation',[f.unit,f.device,id(),command]),callAsync(admin,'lc_apply_operation',[f.unit,f.device,id(),{...command,data:{...command.data,id:id()}}])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sql(`select count(*) from public.cash_closings where day_id=${q(f.day)}`),'1');
 });
 await test('fechamento não pode ser adulterado; entrega/RevGás podem atualizar sem mudar valores',()=>{
  const f=fixture();const sale=f.sale(saleBody({payments:[{category:'gas',method:'creditSale',amount:12000}]}));const p=prepare(f);ack(f,p.roundId);close(f,p);
  const before=sql(`select row_to_json(c)::text from public.cash_closings c where day_id=${q(f.day)}`);
  f.op('sale_update',{id:sale,expectedVersion:1,reason:'Entrega concluída',delivery:{driver:'Wagner',status:'delivered'},posted:true,notes:'Entregue'});
  assert.equal(sql(`select row_to_json(c)::text from public.cash_closings c where day_id=${q(f.day)}`),before);
  rejects(()=>f.op('sale_correct',{id:sale,expectedVersion:2,reason:'Mudar preço',sale:saleBody()}),/LC_CASH_NOT_OPEN/);
  rejects(()=>sql(`delete from public.audit_events where unit_id=${q(f.unit)}`),/LC_IMMUTABLE_HISTORY/);
 });
 await test('recebimento no próximo caixa não modifica venda/fechamento anteriores',()=>{
  const f=fixture();const sale=f.sale(saleBody({payments:[{category:'gas',method:'creditSale',amount:12000}]}));const oldDay=f.day;const p=prepare(f);ack(f,p.roundId);close(f,p);
  f.day=id();f.op('open_day',{id:f.day,date:'2026-11-13',initialCash:0,initialFund:10000});f.op('receipt_create',{id:id(),saleId:sale,target:'gas',amount:6000,method:'cash'});
  assert.equal(f.report().sales,0);assert.equal(f.report().pending,6000);assert.equal(f.report().physical.cash,6000);
  assert.equal(sql(`select expected_cash from public.cash_closings where day_id=${q(oldDay)}`),'50000');
 });
 await test('anotação vazia e incompleta é editável sem abrir caixa nem presumir fiado',()=>{
  const f=fixture({open:false});const draft=id();f.op('draft_save',{id:draft,document:{}},null);
  f.op('draft_save',{id:draft,expectedVersion:1,document:{notes:'Entregar depois, perguntar pagamento'}},null);
  assert.equal(sql(`select count(*) from public.financial_movements where unit_id=${q(f.unit)}`),'0');
  rejects(()=>f.op('draft_save',{id:draft,expectedVersion:1,document:{}},null),/LC_DRAFT_VERSION_CONFLICT/);
 });
 await test('confirmar rascunho preserva seu UUID e não exige cliente ou entregador',()=>{
  const f=fixture();const draft=id();f.op('draft_save',{id:draft,document:{items:[{product:'p13'}]}});
  const body=saleBody({customer:'',delivery:{}});f.op('sale_create',{id:draft,draftVersion:1,sale:body});
  assert.equal(sql(`select converted_sale_id from public.sale_drafts where id=${q(draft)}`),draft);
  assert.equal(f.report().sales,12000);assert.equal(f.report().deliveries,1);
  rejects(()=>f.op('draft_save',{id:draft,expectedVersion:2,document:{} }),/LC_DRAFT_VERSION_CONFLICT/);
 });
 await test('feed incremental usa cursor de mudanças retornadas e respeita unidade',()=>{
  const f=fixture();const r=call(admin,'lc_changes',[f.unit,0,1]);assert.equal(r.changes.length,1);assert.equal(r.hasMore,true);
  const second=call(admin,'lc_changes',[f.unit,r.cursor,500]);assert.ok(second.changes.every(c=>c.unit_id===f.unit&&c.version>r.cursor));
  rejects(()=>call(stranger,'lc_changes',[f.unit,0,500]),/LC_PERMISSION_DENIED/);
 });

 await test('JWT de sessão anônima não acessa dados mesmo com UUID de membro',()=>{
  const f=fixture();const stmt=`set local "request.jwt.claims"='{"is_anonymous":true}';select count(*) from public.cash_days where unit_id=${q(f.unit)}`;
  assert.equal(sql(as(admin,stmt)),'0');
  assert.equal(sql(as(admin,`set local "request.jwt.claims"=' {"is_anonymous":true}';select count(*) from public.profiles`)),'0');
  rejects(()=>sql(as(admin,`set local "request.jwt.claims"='{"is_anonymous":true}';select public.lc_day_report(${q(f.unit)},${q(f.day)})`)),/LC_PERMISSION_DENIED/);
 });
 await test('RLS cobre todas as tabelas públicas e auxiliares não têm execute acidental',()=>{
  assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"),'0');
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and ((p.proname<>'has_permission' and has_function_privilege('authenticated',p.oid,'execute')) or has_function_privilege('anon',p.oid,'execute'))"),'0');
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'lc_%' and has_function_privilege('anon',p.oid,'execute')"),'0');
 });
 await test('FK composta rejeita ligar venda de uma unidade ao caixa de outra',()=>{
  const f=fixture(),other=fixture();
  rejects(()=>sql(`begin;insert into public.sales(id,unit_id,day_id,created_by) values (${q(id())},${q(f.unit)},${q(other.day)},${q(admin)});commit;`),/foreign key constraint/);
 });
 await test('duas retiradas concorrentes não gastam o mesmo saldo do fundo',async()=>{
  const f=fixture();const dev=newDevice(f);const cmd={type:'movement',dayId:f.day,data:{id:id(),type:'transfer',amount:8000,from:'fund',to:'cash',description:'Troca de notas'}};
  const other={...cmd,data:{...cmd.data,id:id()}},a=f.enqueue(cmd),b=id();call(admin,'lc_publish_queue',[f.unit,dev,2,[{id:b,command:other}]]);
  const results=await Promise.allSettled([callAsync(admin,'lc_apply_operation',[f.unit,f.device,a,cmd]),callAsync(admin,'lc_apply_operation',[f.unit,dev,b,other])]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/LC_INSUFFICIENT_FUNDS/);assert.equal(f.report().physical.fund,2000);
 });
 await test('repetição simultânea do mesmo comando produz uma única venda',async()=>{
  const f=fixture();const cmd={type:'sale_create',dayId:f.day,data:{id:id(),sale:saleBody()}},op=f.enqueue(cmd);
  const results=await Promise.all([callAsync(admin,'lc_apply_operation',[f.unit,f.device,op,cmd]),callAsync(admin,'lc_apply_operation',[f.unit,f.device,op,cmd])]);
  assert.deepEqual(results[0],results[1]);assert.equal(f.report().sales,12000);
 });
 await test('restrições diferidas rejeitam parcela extra e movimento sem partida',()=>{
  const f=fixture(),sale=f.sale();
  rejects(()=>sql(`insert into public.payment_allocations(unit_id,sale_id,revision,line_no,category,method,amount) values (${q(f.unit)},${q(sale)},1,2,'gas','pix',1);`),/LC_INVALID_VERSION_PAYMENTS/);
  rejects(()=>sql(`insert into public.financial_movements(id,unit_id,day_id,type,description,actor_id) values (${q(id())},${q(f.unit)},${q(f.day)},'income','Sem partida',${q(admin)});`),/LC_MOVEMENT_POSTING_MISMATCH/);
  assert.equal(f.report().sales,12000);
 });
 await test('venda avulsa antiga preserva valores e não ganha categoria inventada',()=>{
  const f=fixture();f.op('movement',{id:id(),type:'sale',amount:12000,received:15000,description:'Registro antigo sem produto'});
  assert.equal(f.report().sales,0);assert.equal(f.report().legacySales,12000);assert.equal(f.report().physical.total,72000);
 });
 await test('completar só um dado depois não apaga observações, endereço ou RevGás',()=>{
  const f=fixture(),sale=f.sale(saleBody({notes:'Deixou casco',posted:true,address:{district:'Centro'}}));
  f.op('sale_update',{id:sale,expectedVersion:1,reason:'Informou entregador',delivery:{driver:'Vinicius'}});
  const saved=JSON.parse(sql(`select row_to_json(s) from public.sales s where id=${q(sale)}`));
  assert.equal(saved.notes,'Deixou casco');assert.equal(saved.posted,true);assert.equal(saved.address.district,'Centro');
  f.op('sale_update',{id:sale,expectedVersion:2,reason:'Informou cliente',customer:'José',address:{street:'Rua Nova'}});
  const changed=JSON.parse(sql(`select row_to_json(s) from public.sales s where id=${q(sale)}`));
  assert.equal(changed.customer,'José');assert.equal(changed.address.district,'Centro');assert.equal(changed.address.street,'Rua Nova');assert.equal(f.report().sales,12000);
  assert.equal(sql(`select before_data#>>'{delivery,driver}' from public.audit_events where unit_id=${q(f.unit)} and event_type='sale_update' order by created_at desc limit 1`),'Vinicius');
  assert.equal(sql(`select jsonb_typeof(after_data#>'{financial,items}') from public.audit_events where unit_id=${q(f.unit)} and event_type='sale_update' order by created_at desc limit 1`),'array');
 });
 await test('pendência anunciada durante rodada bloqueia fechamento até reconciliar',()=>{
  const f=fixture();const prepared=prepare(f);ack(f,prepared.roundId);
  const cmd={type:'movement',dayId:f.day,data:{id:id(),type:'income',amount:100,account:'cash',description:'Chegou depois'}};const op=f.enqueue(cmd);
  rejects(()=>close(f,prepared),/LC_PENDING_OPERATIONS/);rejects(()=>f.apply(cmd,op),/LC_CASH_NOT_OPEN/);
  f.op('close_abort',{roundId:prepared.roundId,reason:'Reconciliar operação recebida'});f.apply(cmd,op);
  const newRound=prepare(f);ack(f,newRound.roundId);close(f,newRound);assert.equal(f.report().physical.cash,50100);
 });

 await test('operador confirma seu manifesto na rodada sem ganhar permissão de fechar',()=>{
  const f=fixture();sql(`insert into public.unit_memberships(unit_id,user_id,role) values (${q(f.unit)},${q(operator)},'operator');`);
  const dev=id();call(operator,'lc_register_device',[f.unit,dev,'Celular da operadora']);call(operator,'lc_publish_queue',[f.unit,dev,1,[]]);
  const prepared=prepare(f);ack(f,prepared.roundId);
  call(operator,'lc_apply_operation',[f.unit,dev,id(),{type:'close_ack',dayId:f.day,data:{roundId:prepared.roundId,manifestGeneration:1}}]);
  rejects(()=>call(operator,'lc_apply_operation',[f.unit,dev,id(),{type:'close_commit',dayId:f.day,data:{}}]),/LC_PERMISSION_DENIED/);
  close(f,prepared);
 });
 console.log(`Banco: ${passed} testes aprovados; ${failed} falharam.`);
 if(failed) throw new Error(`${failed} testes de banco falharam`);
}
