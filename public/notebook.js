import { prepareState, createSale } from './commerce.js';
import { text } from './domain.js';
const uuid = () => crypto.randomUUID();
function event(state,draft,type,user,before,reason) {
 state.business.events.push({id:uuid(),type,entityId:draft.id,createdAt:new Date().toISOString(),user,reason,before,after:structuredClone(draft),syncStatus:'pending'});
}
export function saveDraft(state,id,document,user='Não informado',expectedVersion=null) {
 const next=structuredClone(prepareState(state));
 if(!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identificador de anotação inválido.');
 if(!document || typeof document!=='object' || Array.isArray(document) || new TextEncoder().encode(JSON.stringify(document)).length>65536) throw new Error('A anotação ultrapassa o limite permitido.');
 if(next.business.sales.some(s=>s.id===id)) throw new Error('Esta anotação já foi confirmada. Use Corrigir venda.');
 const old=next.business.drafts.find(d=>d.id===id);
 if(old && (old.status!=='draft' || old.version!==expectedVersion)) throw new Error('A anotação mudou. Reabra antes de editar.');
 user=text(user || 'Não informado','Responsável',true,100);
 const draft={id,dayId:old?.dayId ?? next.days.find(d=>!d.closing)?.id ?? null,createdAt:old?.createdAt ?? new Date().toISOString(),updatedAt:new Date().toISOString(),user,document:structuredClone(document),version:(old?.version??0)+1,status:'draft',syncStatus:'pending'};
 next.business.drafts=old?next.business.drafts.map(d=>d.id===id?draft:d):[...next.business.drafts,draft];
 event(next,draft,old?'draftUpdated':'draftCreated',user,old??null,'Anotação salva sem efeito financeiro');
 return next;
}
export function confirmDraft(state,id,input,user) {
 const current=prepareState(state),old=current.business.drafts.find(d=>d.id===id);
 if(old && old.status!=='draft') throw new Error('Esta anotação já foi confirmada ou arquivada.');
 const next=createSale(current,input,user,id);
 if(old) {
  const converted={...old,status:'converted',saleId:id,version:old.version+1,updatedAt:new Date().toISOString()};
  next.business.drafts=next.business.drafts.map(d=>d.id===id?converted:d);
  event(next,converted,'draftConfirmed',user,old,'Anotação confirmada como venda');
 }
 return next;
}
export function archiveDraft(state,id,user='Não informado') {
 const next=structuredClone(prepareState(state)),old=next.business.drafts.find(d=>d.id===id);
 if(!old || old.status!=='draft') throw new Error('Anotação indisponível.');
 const archived={...old,status:'canceled',version:old.version+1,updatedAt:new Date().toISOString()};
 next.business.drafts=next.business.drafts.map(d=>d.id===id?archived:d);
 event(next,archived,'draftArchived',user,old,'Anotação arquivada sem exclusão');
 return next;
}
