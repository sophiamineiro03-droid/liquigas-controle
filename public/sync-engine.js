import { projectSnapshot } from './sync-projection.js';
import { initialImportPlan } from './sync-commands.js';
const tables={profiles:'id',unit_settings:'unit_id',cash_days:'id',financial_movements:'id',movement_entries:'id',sales:'id',sale_versions:'sale_id,revision',deliveries:'id',debt_receipts:'id',sale_drafts:'id',audit_events:'id',cash_closings:'id'};
const businessErrors=new Set(['22023','23505','23514','P0001']);
export function createSyncEngine({client,read,update,onChange=()=>{},online=()=>navigator.onLine}) {
  let running=false, active=false, retryAt=0, failures=0;
  async function persist(fn) {const value=await update(fn);onChange(value);return value;}
  async function rpc(name,args) {const {data,error}=await client.rpc(name,args);if(error)throw error;return data;}
  async function identity() {
    const {data,error}=await client.auth.getSession();if(error)throw error;
    const session=data.session;
    if(!session)throw new Error('Entre na sua conta para enviar os registros. Eles continuam salvos neste aparelho.');
    const state=await read();
    if(state.remote?.enabled && state.remote.userId!==session.user.id)throw new Error('Esta cópia pertence a outra conta. Entre com a conta original.');
    return session.user.id;
  }
  async function memberships() {
    await identity();const {data,error}=await client.from('unit_memberships').select('unit_id,role').eq('active',true);
    if(error)throw error;if(data.length!==1)throw new Error('Sua conta precisa estar vinculada à unidade pela configuração administrativa.');return data[0];
  }
  async function activate(importLocal=false) {
    const userId=await identity(), membership=await memberships(), state=await read();
    if(state.remote?.enabled)return;
    const hasLocal=state.days.length || state.business.sales.length || state.business.receipts.length || state.business.drafts.length;
    const queue=importLocal?initialImportPlan(state):[];
    // Um segundo aparelho conecta ao estado central, sem importar sua cópia antiga.
    if(importLocal) {
      const {data,error}=await client.from('cash_days').select('id').eq('unit_id',membership.unit_id).limit(1);
      if(error)throw error;if(data.length)throw new Error('A unidade já tem dados. A importação desta cópia precisa de reconciliação; conecte preservando-a no arquivo local.');
    }
    const deviceId=crypto.randomUUID();
    await rpc('lc_register_device',{p_unit:membership.unit_id,p_device:deviceId,p_name:'Navegador '+deviceId.slice(0,8)});
    await persist(current=>{
      if(current.revision!==state.revision)throw new Error('Os dados locais mudaram. Confira a importação novamente.');
      current.localArchive={createdAt:new Date().toISOString(),ledger:{...current}};
      current.remote={enabled:true,unitId:membership.unit_id,userId,deviceId,generation:0,cursor:0,hydrated:false,importing:!!importLocal,lastError:'',queue:queue.map(cmd=>({id:crypto.randomUUID(),command:JSON.parse(JSON.stringify(cmd)),state:'pending',attempts:0,actorId:userId,createdAt:new Date().toISOString()}))};
      if(!importLocal){current.days=[];current.business={schemaVersion:1,benefitPrice:10798,sales:[],receipts:[],events:[],drafts:[]};}
      return current;
    });
    await sync();
  }
  async function manifest(state) {
    const r=state.remote;
    const operations=r.queue.filter(q=>q.state!=='confirmed').map(q=>({id:q.id,command:q.command}));
    if(operations.length>1000)throw new Error('A fila ultrapassou 1000 operações. Exporte a cópia para reconciliar sem perder registros.');
    if(!r.manifest || JSON.stringify(r.manifest.operations)!==JSON.stringify(operations)) {
      state=await persist(s=>{s.remote.generation++;s.remote.manifest={generation:s.remote.generation,operations};s.remote.manifestPublished=false;return s;});
    }
    if(!state.remote.manifestPublished) {
      const m=state.remote.manifest;
      await rpc('lc_publish_queue',{p_unit:r.unitId,p_device:r.deviceId,p_generation:m.generation,p_operations:m.operations});
      state=await persist(s=>{if(s.remote.manifest.generation===m.generation)s.remote.manifestPublished=true;return s;});
    }
    return state;
  }
  async function snapshot(unitId) {
    async function all(table,order) {
      const result=[];for(let start=0;;start+=500){
        let query=client.from(table).select('*');if(table!=='profiles')query=query.eq('unit_id',unitId);
        for(const column of order.split(','))query=query.order(column);
        const {data,error}=await query.range(start,start+499);if(error)throw error;result.push(...data);if(data.length<500)return result;
      }
    }
    const rows={};await Promise.all(Object.entries(tables).map(async([table,order])=>{rows[table]=await all(table,order);}));return rows;
  }
  async function pull() {
    let state=await read(), r=state.remote;
    if(r.queue.length)return;
    const {data:unit,error}=await client.from('operating_units').select('change_version').eq('id',r.unitId).single();if(error)throw error;
    if(r.hydrated && unit.change_version===r.cursor)return;
    // O feed define o cursor; a fotografia só é aceita se a unidade não mudou durante a leitura.
    let cursor=r.cursor,more=true;
    while(more){const feed=await rpc('lc_changes',{p_unit:r.unitId,p_after:cursor,p_limit:500});cursor=feed.cursor;more=feed.hasMore;}
    const rows=await snapshot(r.unitId);
    const {data:after,error:afterError}=await client.from('operating_units').select('change_version').eq('id',r.unitId).single();if(afterError)throw afterError;
    if(after.change_version!==cursor)return; // próxima tentativa busca novamente, sem avançar cursor.
    await persist(s=>{
      if(s.remote.queue.length)return s;
      const projected=projectSnapshot(rows,s);
      projected.remote={...s.remote,cursor,hydrated:true,importing:false,lastError:'',lastSyncedAt:new Date().toISOString()};return projected;
    });
  }
  async function onlineOperation(key,cmd) {
    let s=await read();
    if(!s.remote.controls?.[key]) s=await persist(s=>{s.remote.controls??={};s.remote.controls[key]={id:crypto.randomUUID(),command:cmd};return s;});
    const operation=s.remote.controls[key];
    return rpc('lc_apply_operation',{p_unit:s.remote.unitId,p_device:s.remote.deviceId,p_operation:operation.id,p_command:operation.command});
  }
  async function closing() {
    let s=await read();if(s.remote.queue.length)return;
    for(const day of s.days.filter(d=>d.remoteStatus==='closing')) {
      await onlineOperation('ack:'+day.closeRoundId+':'+s.remote.generation, {type:'close_ack',dayId:day.id,data:{roundId:day.closeRoundId,manifestGeneration:s.remote.generation}});
      // O ID muda quando a geração muda, mantendo o comando anunciado imutável.
    }
    s=await read();const request=s.remote.closeRequest;if(!request)return;
    if(!request.roundId) {
      const response=await onlineOperation('prepare:'+request.id,{type:'close_prepare',dayId:request.dayId,data:{}});
      await persist(s=>{s.remote.closeRequest={...s.remote.closeRequest,roundId:response.result.roundId,financialVersion:response.result.financialVersion};return s;});
      await pull();return;
    }
    const day=s.days.find(d=>d.id===request.dayId);
    if(day?.closing){await persist(s=>{delete s.remote.closeRequest;return s;});return;}
    try {
      await onlineOperation('commit:'+request.id,{type:'close_commit',dayId:request.dayId,data:{id:request.id,roundId:request.roundId,financialVersion:request.financialVersion,countedCash:request.countedCash,countedFund:request.countedFund,notes:request.notes}});
      await persist(s=>{delete s.remote.closeRequest;return s;});await pull();
    } catch(error) {
      if(/LC_DEVICES_NOT_ACKNOWLEDGED/.test(error.message)){await persist(s=>{s.remote.lastError='Fechamento aguardando confirmação dos outros aparelhos. Abra o sistema neles com internet.';return s;});return;}
      throw error;
    }
  }
  async function cycle() {
    if(running || !online() || Date.now()<retryAt)return;
    const initial=await read();if(!initial.remote?.enabled || initial.remote.reconciling)return;
    running=true;
    try {
      const userId=await identity();
      let s=await read();
      if(s.remote.queue.some(q=>q.actorId!==userId))throw new Error('Há operações de outra conta nesta fila. Envio pausado.');
      s=await manifest(s);
      while(s.remote.queue.length) {
        const operation=s.remote.queue[0];if(operation.state==='conflict')break;
        if(!s.remote.manifest.operations.some(q=>q.id===operation.id))s=await manifest(s);
        try {
          await persist(current=>{const q=current.remote.queue.find(q=>q.id===operation.id);q.attempts=(q.attempts??0)+1;return current;});
          await rpc('lc_apply_operation',{p_unit:s.remote.unitId,p_device:s.remote.deviceId,p_operation:operation.id,p_command:operation.command});
          s=await persist(s=>{s.remote.queue=s.remote.queue.filter(q=>q.id!==operation.id);s.remote.lastError='';return s;});
        } catch(error) {
          if(businessErrors.has(error.code))await persist(s=>{const q=s.remote.queue.find(q=>q.id===operation.id);q.state='conflict';q.error=error.message;s.remote.lastError='Operação aguardando conferência: '+error.message;return s;});
          throw error;
        }
      }
      if(!s.remote.queue.length){await manifest(await read());await pull();await closing();}
      failures=0;retryAt=0;
    } catch(error) {
      const message=error.message || 'Não foi possível enviar agora. Os dados continuam neste aparelho.';
      await persist(s=>{if(s.remote)s.remote.lastError=message;return s;});
      failures++;retryAt=Date.now()+Math.min(60000,1000*2**Math.min(failures,6));
    } finally {running=false;}
  }
  async function sync(force=false) {
    if(force)retryAt=0;
    if(globalThis.navigator?.locks)return navigator.locks.request('liquigas-remote-sync',{ifAvailable:true},lock=>lock?cycle():undefined);
    return cycle();
  }
  function start(){if(active)return;active=true;setInterval(()=>{void sync();},5000);globalThis.addEventListener?.('online',()=>{retryAt=0;void sync();});void sync();}
  async function requestClose(dayId,input) {
    if(!online())throw new Error('Fechamento definitivo precisa de internet. Os lançamentos offline continuam preservados.');
    await sync();const s=await read();if(s.remote.queue.length)throw new Error('Aguarde o envio ou confira as pendências antes de fechar.');
    await persist(s=>{s.remote.closeRequest??={id:crypto.randomUUID(),dayId,...input};return s;});retryAt=0;await sync();
  }
  async function discard(reason) {
    async function reconcile() {
      await identity();let s=await read();
      if(!reason?.trim() && !s.remote.reconciling)throw new Error('Informe o motivo da reconciliação.');
      if(!s.remote.reconciling) {
        s=await manifest(s);
        s=await persist(current=>{
          current.remote.reconciling={reason,ids:current.remote.queue.map(q=>q.id),completed:[]};
          current.remote.conflictArchives??=[];
          current.remote.conflictArchives.push({reason,createdAt:new Date().toISOString(),ledger:{days:current.days,business:current.business},queue:structuredClone(current.remote.queue)});
          return current;
        });
      }
      const task=s.remote.reconciling;
      for(const id of task.ids.filter(id=>!task.completed.includes(id))) {
        // Timeout pode esconder um commit já aceito: confirmar, nunca tentar desfazer via descarte.
        const {data:accepted,error}=await client.from('sync_operations').select('id').eq('unit_id',s.remote.unitId).eq('id',id);
        if(error)throw error;
        if(!accepted.length)await rpc('lc_discard_pending',{p_unit:s.remote.unitId,p_device:s.remote.deviceId,p_operation:id,p_reason:task.reason});
        await persist(current=>{current.remote.reconciling.completed.push(id);return current;});
      }
      const {data,error}=await client.from('devices').select('manifest_generation').eq('id',s.remote.deviceId).single();if(error)throw error;
      await persist(current=>{
        current.remote.queue=current.remote.queue.filter(q=>!task.ids.includes(q.id));
        current.remote.generation=data.manifest_generation;delete current.remote.manifest;delete current.remote.reconciling;
        current.remote.manifestPublished=false;current.remote.hydrated=false;return current;
      });
    }
    if(globalThis.navigator?.locks)await navigator.locks.request('liquigas-remote-sync',reconcile);
    else {if(running)throw new Error('Aguarde o envio em andamento e tente novamente.');await reconcile();}
    retryAt=0;await sync();
  }

  return {start,sync,activate,memberships,requestClose,discard,onlineOperation};
}
