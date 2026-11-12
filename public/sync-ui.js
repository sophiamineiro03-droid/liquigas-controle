import { supabase } from './supabase-client.js';
import { createSyncEngine } from './sync-engine.js';
import { load, updateStored } from './storage.js';
import { initialImportPlan } from './sync-commands.js';
export function setupSyncUI({changed,onError}) {
  const $=selector=>document.querySelector(selector);
  let session=null, last=null, busy=false;
  const engine=createSyncEngine({client:supabase,read:load,update:updateStored,onChange:state=>{last=state;changed(state);render(state);}});
  function render(state) {
    last=state;
    const enabled=state.remote?.enabled;
    $('#account-state').textContent=session?'Conta conectada':'Conta desconectada';
    $('#remote-login').hidden=!!session;
    $('#remote-activate').hidden=!session||enabled;
    $('#remote-actions').hidden=!enabled;
    $('#sync-discard').hidden=!(state.remote?.reconciling || state.remote?.queue.some(q=>q.state==='conflict'));
    $('#sync-abort').hidden=!state.days.some(d=>d.remoteStatus==='closing');
    $('#sync-detail').textContent=enabled ? (state.remote.lastError || (state.remote.queue.length ? `${state.remote.queue.length} operações aguardando envio. Os dados estão salvos neste aparelho.` : state.remote.hydrated ? 'Sem pendências de envio. Atualização automática entre aparelhos ativa.' : 'Buscando dados da unidade…')) : 'Entre na sua conta para conectar este aparelho. Os registros atuais continuam preservados localmente.';
    $('#local-notice').textContent=enabled?'Modo compartilhado. Sem internet, os lançamentos ficam neste aparelho até o servidor confirmar o envio.':'Dados locais neste navegador. Conecte sua conta para ativar o envio automático. Exporte uma cópia antes da primeira importação.';
  }
  async function action(fn) {if(busy)return;busy=true;try{await fn();$('#account-error').textContent='';}catch(e){$('#account-error').textContent=e.message||'Não foi possível concluir.';}finally{busy=false;}}
  $('#remote-login').onsubmit=event=>{event.preventDefault();void action(async()=>{
    const email=$('#account-email').value.trim(), password=$('#account-password').value;
    const {data,error}=await supabase.auth.signInWithPassword({email,password});$('#account-password').value='';if(error)throw error;
    session=data.session;await engine.memberships();render(await load());engine.start();
  });};
  $('#activate-import').onclick=()=>void action(async()=>{
    const state=await load(), plan=initialImportPlan(state);
    const summary=`Enviar para a unidade ${state.days.length} caixa(s), ${state.business.sales.length} venda(s), ${state.business.receipts.length} recebimento(s) e ${state.business.drafts.filter(d=>d.status==='draft').length} anotação(ões)? Serão ${plan.length} operações. Exporte e confira sua cópia antes de continuar. Os UUIDs serão preservados.`;
    if(!confirm(summary))return;await engine.activate(true);render(await load());
  });
  $('#activate-connect').onclick=()=>void action(async()=>{
    const s=await load();if((s.days.length||s.business.drafts.length)&&!confirm('Conectar aos dados da unidade sem enviar os registros locais antigos? Uma cópia completa ficará preservada neste navegador e na exportação. Exporte antes de continuar.'))return;
    await engine.activate(false);render(await load());
  });
  $('#sync-now').onclick=()=>void engine.sync(true);
  $('#sync-discard').onclick=()=>void action(async()=>{
    const s=await load();if(!confirm(`Reconciliar ${s.remote.queue.length} operações pendentes com o servidor? As intenções locais serão arquivadas na cópia exportável, sem serem aplicadas ao financeiro. Confira e exporte antes de confirmar.`))return;
    const reason=prompt('Motivo da reconciliação (obrigatório):');if(!reason)return;await engine.discard(reason);
  });
  $('#sync-abort').onclick=()=>void action(async()=>{
    const state=await load(), day=state.days.find(d=>d.remoteStatus==='closing');if(!day)return;
    const reason=prompt('Motivo para abortar a preparação do fechamento:');if(!reason)return;
    await engine.onlineOperation('abort:'+day.closeRoundId,{type:'close_abort',dayId:day.id,data:{roundId:day.closeRoundId,reason}});
    await updateStored(s=>{delete s.remote.closeRequest;return s;});await engine.sync();
  });
  $('#account-logout').onclick=()=>void action(async()=>{
    const s=await load();if(s.remote?.queue.length)throw new Error('Envie ou reconcilie as pendências antes de sair.');
    if(!confirm('Sair da conta? A cópia offline permanece neste perfil do navegador. Use somente em aparelho seu.'))return;
    const {error}=await supabase.auth.signOut();if(error)throw error;session=null;render(await load());
  });
  supabase.auth.onAuthStateChange((_event,value)=>{session=value;queueMicrotask(()=>{if(last)render(last);if(value)engine.start();});});
  void supabase.auth.getSession().then(({data})=>{session=data.session;void load().then(render);engine.start();}).catch(onError);
  return {engine,render};
}
