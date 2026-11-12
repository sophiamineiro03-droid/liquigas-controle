import test from 'node:test';
import assert from 'node:assert/strict';
import { openDay,addMovement,closeDay } from '../public/domain.js';
import { prepareState,createSale,editSale,updateSale,cancelSale,addReceipt,reverseReceipt,configureBenefit } from '../public/commerce.js';
import { saveDraft,confirmDraft,archiveDraft } from '../public/notebook.js';
import { commandsForChange,appendOutbox,initialImportPlan } from '../public/sync-commands.js';
const empty=()=>prepareState({revision:0,days:[]});
const start=()=>({...empty(),days:[openDay([],{date:'2026-11-12',initialCash:50000,initialFund:10000,user:'Admin'})]});
const fields={customer:'',items:[{product:'p13',quantity:1,total:12000}],payments:[{category:'gas',method:'cash',amount:12000}],delivery:{driver:'',status:''},posted:false};
const remote=s=>({...s,remote:{enabled:true,unitId:crypto.randomUUID(),deviceId:crypto.randomUUID(),userId:'admin',queue:[]}});
test('abertura e movimento legados geram comandos completos com UUID original',()=>{
 const before=empty(),next=start();assert.equal(commandsForChange(before,next)[0].data.id,next.days[0].id);
 const moved=structuredClone(next);moved.days[0]=addMovement(moved.days[0],{type:'sale',amount:12000,received:20000,description:'Venda',user:'Admin'});
 const [cmd]=commandsForChange(next,moved);assert.equal(cmd.type,'movement');assert.equal(cmd.data.amount,12000);assert.equal(cmd.data.received,20000);
});
test('salvar anotação e confirmar compartilha UUID e versão sem duplicar movimentos comerciais',()=>{
 const before=remote(start()),id=crypto.randomUUID(),draft=saveDraft(before,id,{},'Admin');
 const first=appendOutbox(before,draft);assert.equal(first.remote.queue[0].command.type,'draft_save');
 const confirmed=appendOutbox(first,confirmDraft(first,id,fields,'Admin'));
 assert.equal(confirmed.remote.queue.length,2);const cmd=confirmed.remote.queue[1].command;
 assert.equal(cmd.type,'sale_create');assert.equal(cmd.data.id,id);assert.equal(cmd.data.draftVersion,1);
 assert.deepEqual(cmd.data.sale.delivery,{driver:null,driverOther:'',status:null});
 assert.equal(confirmed.business.sales[0].entityVersion,1);
});
test('correção, metadados e cancelamento usam versões esperadas e estornos exatos',()=>{
 let s=createSale(start(),fields,'Admin');const id=s.business.sales[0].id;
 let n=editSale(s,id,fields,'Correção','Admin'),[cmd]=commandsForChange(s,n);
 assert.equal(cmd.type,'sale_correct');assert.equal(cmd.data.expectedVersion,1);assert.equal(n.business.sales[0].entityVersion,2);
 s=n;n=updateSale(s,id,{customer:'Maria'},'Nome','Admin');[cmd]=commandsForChange(s,n);assert.equal(cmd.data.expectedVersion,2);assert.equal(n.business.sales[0].entityVersion,3);
 s=n;n=cancelSale(s,id,'Cancelar','Admin');[cmd]=commandsForChange(s,n);assert.equal(cmd.type,'sale_cancel');assert.equal(cmd.data.expectedVersion,3);
 assert.equal(n.days[0].movements.find(m=>m.id===cmd.data.reversalId).reverses,s.business.sales[0].movementId);
});
test('recebimentos não geram movimento avulso duplicado e estorno usa versão',()=>{
 const s=createSale(start(),{...fields,payments:[{category:'gas',method:'creditSale',amount:12000}]},'Admin');
 let n=addReceipt(s,{saleId:s.business.sales[0].id,target:'gas',method:'cash',amount:1000},'Admin');
 const cmds=commandsForChange(s,n);assert.equal(cmds.length,1);assert.equal(cmds[0].type,'receipt_create');
 const r=reverseReceipt(n,n.business.receipts[0].id,'Erro','Admin');const [cmd]=commandsForChange(n,r);assert.equal(cmd.type,'receipt_reverse');assert.equal(cmd.data.expectedVersion,1);
});
test('fila e payload antigo permanecem imutáveis ao acrescentar outra operação',()=>{
 const s=remote(start()),a=appendOutbox(s,createSale(s,fields,'Admin')),saved=structuredClone(a.remote.queue[0]);
 const b=appendOutbox(a,updateSale(a,a.business.sales[0].id,{customer:'Maria'},'Nome','Admin'));
 assert.deepEqual(b.remote.queue[0],saved);assert.equal(b.remote.queue[1].actorId,'admin');assert.notEqual(b.remote.queue[1].id,saved.id);
});
test('fechamento offline e escrita durante rodada são rejeitados sem perder fila',()=>{
 const s=remote(start()),n=structuredClone(s);n.days[0]=closeDay(n.days[0],{countedCash:50000,countedFund:10000,user:'Admin'});
 assert.throws(()=>appendOutbox(s,n),/online/);
 s.days[0].remoteStatus='closing';assert.throws(()=>appendOutbox(s,createSale(s,fields,'Admin')),/fechamento/);
});
test('plano inicial preserva UUIDs, rejeita fechados e histórico com estornos',()=>{
 const s=createSale(start(),fields,'Admin'),[open,sale]=initialImportPlan(s);
 assert.equal(open.data.id,s.days[0].id);assert.equal(sale.data.id,s.business.sales[0].id);assert.equal(sale.data.movementId,s.business.sales[0].movementId);
 assert.throws(()=>initialImportPlan(cancelSale(s,s.business.sales[0].id,'Erro','Admin')),/conferência/);
 s.days[0]=closeDay(s.days[0],{countedCash:62000,countedFund:10000,user:'Admin'});assert.throws(()=>initialImportPlan(s),/fechados/);
});
test('cancelamento de rascunho e configuração de preço usam versão correta',()=>{
 const s=saveDraft(start(),crypto.randomUUID(),{},'Admin'),n=archiveDraft(s,s.business.drafts[0].id);
 assert.equal(commandsForChange(s,n)[0].data.expectedVersion,1);
 const a=configureBenefit(s,11000,'Admin');assert.equal(commandsForChange(s,a)[0].data.expectedVersion,1);
 const b=configureBenefit(a,12000,'Admin');assert.equal(commandsForChange(a,b)[0].data.expectedVersion,2);
});
