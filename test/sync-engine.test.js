import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine } from '../public/sync-engine.js';
import { prepareState } from '../public/commerce.js';
function fixture() {
 let state=prepareState({revision:0,days:[],remote:{enabled:true,unitId:'unit',userId:'admin',deviceId:'device',generation:0,cursor:0,hydrated:true,queue:[]}});
 const applied=new Map(),calls=[];let failAfterCommit=false,errorCode=null,sessionUser='admin',online=true;
 const client={auth:{getSession:async()=>({data:{session:sessionUser?{user:{id:sessionUser}}:null}})},from(table){return {select(){return this;},eq(){return this;},single:async()=>({data:table==='devices'?{manifest_generation:5}:{change_version:0}})};},rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='lc_apply_operation') {
   if(errorCode)return {error:{code:errorCode,message:errorCode==='P0001'?'LC_OVERPAYMENT':'Expired session'}};
   const existing=applied.get(args.p_operation);if(existing)return {data:existing};
   const response={operationId:args.p_operation,serverVersion:1,result:{}};applied.set(args.p_operation,response);
   if(failAfterCommit){failAfterCommit=false;return {error:{message:'Network timeout'}};}
   return {data:response};
  }
  return {data:{accepted:true}};
 }};
 const engine=createSyncEngine({client,read:async()=>structuredClone(state),update:async fn=>{const n=fn(structuredClone(state));state={...n,revision:state.revision+1};return structuredClone(state);},online:()=>online});
 return {engine,calls,applied,get state(){return state;},enqueue(){state.remote.queue.push({id:crypto.randomUUID(),actorId:'admin',state:'pending',command:{type:'movement',dayId:'day',data:{id:crypto.randomUUID(),type:'income',amount:100,account:'cash',description:'Entrada'}}});},timeout(){failAfterCommit=true;},error(code){errorCode=code;},user(id){sessionUser=id;},offline(){online=false;}};
}
test('timeout após commit repete o mesmo ID e payload sem duplicar aplicação',async()=>{
 const f=fixture();f.enqueue();const original=structuredClone(f.state.remote.queue[0]);f.timeout();await f.engine.sync();
 assert.equal(f.applied.size,1);assert.equal(f.state.remote.queue.length,1);
 await f.engine.sync(true);assert.equal(f.applied.size,1);assert.equal(f.state.remote.queue.length,0);
 const attempts=f.calls.filter(c=>c.name==='lc_apply_operation');assert.equal(attempts.length,2);assert.equal(attempts[0].args.p_operation,original.id);assert.deepEqual(attempts[0].args,attempts[1].args);
});
test('manifesto antecede envio; novas operações recebem nova geração',async()=>{
 const f=fixture();f.enqueue();await f.engine.sync();f.enqueue();await f.engine.sync();
 assert.equal(f.applied.size,2);const generations=f.calls.filter(c=>c.name==='lc_publish_queue').map(c=>c.args.p_generation);
 assert.ok(generations.every((g,i)=>!i||g>generations[i-1]));assert.equal(f.calls[0].name,'lc_publish_queue');
});
test('erro de negócio preserva intenção e bloqueia dependências sem repetição infinita',async()=>{
 const f=fixture();f.enqueue();f.enqueue();f.error('P0001');await f.engine.sync();
 assert.equal(f.state.remote.queue.length,2);assert.equal(f.state.remote.queue[0].state,'conflict');assert.equal(f.applied.size,0);
 await f.engine.sync(true);assert.equal(f.calls.filter(c=>c.name==='lc_apply_operation').length,1);
});
test('offline, sessão ausente ou outra conta não enviam operações',async()=>{
 for(const mode of ['offline','none','other']){
  const f=fixture();f.enqueue();if(mode==='offline')f.offline();else f.user(mode==='none'?null:'outra');
  await f.engine.sync();assert.equal(f.calls.length,0);assert.equal(f.state.remote.queue.length,1);
 }
});

test('reconciliação guarda arquivo e motivo e pode retomar após falha de rede',async()=>{
 const userId='admin';let state=prepareState({days:[],remote:{enabled:true,unitId:'unit',userId,deviceId:'device',generation:1,cursor:0,hydrated:true,manifest:{generation:1,operations:[]},manifestPublished:true,queue:[{id:'op',actorId:userId,state:'conflict',command:{type:'movement',dayId:'day',data:{}}}]}});
 let fail=true,discardCount=0;
 const client={auth:{getSession:async()=>({data:{session:{user:{id:userId}}}})},rpc:async(name)=>{if(name==='lc_discard_pending'){discardCount++;if(fail){fail=false;throw new Error('timeout');}}return {data:{}};},from(table){return {select(){return this;},eq(){return this;},then(resolve){return Promise.resolve({data:[]}).then(resolve);},single:async()=>({data:table==='devices'?{manifest_generation:3}:{change_version:0}})};}};
 const engine=createSyncEngine({client,read:async()=>structuredClone(state),update:async fn=>(state=fn(structuredClone(state))),online:()=>false});
 await assert.rejects(()=>engine.discard('Conferido'),/timeout/);assert.equal(state.remote.queue.length,1);assert.equal(state.remote.reconciling.reason,'Conferido');assert.equal(state.remote.conflictArchives.length,1);
 await engine.discard('Outro texto');assert.equal(discardCount,2);assert.equal(state.remote.queue.length,0);assert.equal(state.remote.generation,3);assert.equal(state.remote.conflictArchives[0].reason,'Conferido');assert.equal(state.remote.conflictArchives[0].queue[0].id,'op');
});
