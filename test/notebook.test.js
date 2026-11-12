import test from 'node:test';
import assert from 'node:assert/strict';
import {saveDraft,confirmDraft,archiveDraft} from '../public/notebook.js';
import {prepareState,report} from '../public/commerce.js';
import {openDay} from '../public/domain.js';
const base=()=>prepareState({version:1,revision:0,days:[]});
test('anotação vazia pode ser salva sem caixa, cliente ou dinheiro',()=>{
 const id=crypto.randomUUID(),s=saveDraft(base(),id,{});
 assert.equal(s.business.drafts[0].id,id);assert.equal(s.days.length,0);assert.equal(s.business.sales.length,0);
 assert.equal(s.business.events[0].type,'draftCreated');
});
test('editar e arquivar anotação preserva antes/depois e impede revisão antiga',()=>{
 const id=crypto.randomUUID(),a=saveDraft(base(),id,{fields:{customer:'Lala'}});
 const b=saveDraft(a,id,{fields:{customer:'Lala',notes:'Perguntar pagamento'}},'Atendente',1);
 assert.equal(b.business.events[1].before.document.fields.customer,'Lala');
 assert.throws(()=>saveDraft(b,id,{},'Atendente',1));
 const c=archiveDraft(b,id);assert.equal(c.business.drafts[0].status,'canceled');assert.equal(c.business.events.length,3);
});
test('confirmação mantém UUID e recebe dinheiro só uma vez; anotação incompleta não vira fiado',()=>{
 const s=base();s.days.push(openDay([],{date:'2026-11-12',initialCash:0,initialFund:10000,user:'Atendente'}));
 const id=crypto.randomUUID(),a=saveDraft(s,id,{fields:{customer:'',simpleMethod:''}});
 assert.equal(report(a,a.days[0].id).received,0);assert.equal(report(a,a.days[0].id).pending,0);
 const input={customer:'',items:[{product:'p13',quantity:1,total:12000}],payments:[{category:'gas',method:'cash',amount:12000}],delivery:{driver:'',status:''},posted:false};
 const b=confirmDraft(a,id,input,'Atendente');assert.equal(b.business.sales[0].id,id);
 assert.equal(b.business.drafts[0].status,'converted');assert.equal(report(b,b.days[0].id).received,12000);
 assert.throws(()=>confirmDraft(b,id,input,'Atendente'));
 assert.throws(()=>saveDraft(b,id,{}));assert.equal(a.business.drafts[0].status,'draft');
});
test('atualização aditiva preserva vendas e anotações existentes',()=>{
 const old={version:1,revision:4,days:[],business:{schemaVersion:1,benefitPrice:10798,sales:[],receipts:[],events:[]}};
 const next=prepareState(old);assert.deepEqual(next.business.drafts,[]);assert.equal(old.business.drafts,undefined);assert.equal(next.revision,4);
});
