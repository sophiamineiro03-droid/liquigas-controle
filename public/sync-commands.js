import { deliveryToServer } from './sync.js';
const command = (type, dayId, data) => ({ type, dayId: dayId ?? null, data });
function saleDocument(sale) {
  return { ...sale, items: sale.items.map(({id,...item})=>item), payments: sale.payments.map(({id,...pay})=>pay), fee: sale.fee ? { amount: sale.fee.amount, method: sale.fee.method, status: sale.fee.status } : null, delivery: deliveryToServer(sale.delivery) };
}
function movementCommand(movement) {
  const e = movement.entries[0];
  if (movement.type === 'reversal') return command('movement_reverse', movement.dayId, { id: movement.id, movementId: movement.reverses, reason: movement.description });
  const data = { id: movement.id, type: movement.type, description: movement.description, notes: movement.notes, amount: e?.amount };
  if (movement.type === 'sale') { data.amount=movement.saleAmount; data.received=movement.received; }
  else if (['transfer','replenish'].includes(movement.type)) { data.from=e.from; data.to=e.to; }
  else { data.account=e.from === 'external' ? e.to : e.from; if(movement.type==='adjustment') data.direction=e.from === 'external' ? 'increase' : 'decrease'; }
  return command('movement', movement.dayId, data);
}
// Um commit da interface gera intenções imutáveis na mesma transação do ledger.
export function commandsForChange(before, next) {
  const result=[];
  for (const day of next.days) {
    const old=before.days.find(d=>d.id===day.id);
    if (!old) result.push(command('open_day',day.id,{id:day.id,date:day.date,initialCash:day.initialCash,initialFund:day.initialFund,notes:day.notes,createdAt:day.createdAt}));
    const ids=new Set(old?.movements.map(m=>m.id) ?? []);
    for (const m of day.movements) if(!ids.has(m.id) && !m.commerceId && !(m.reverses && day.movements.find(original=>original.id===m.reverses)?.commerceId)) result.push(movementCommand(m));
    if(day.closing && !old?.closing) throw new Error('O fechamento compartilhado precisa ser confirmado online pelo servidor.');
  }
  const oldEvents=new Set(before.business.events.map(e=>e.id));
  for (const event of next.business.events.filter(e=>!oldEvents.has(e.id))) {
    const { before: old, after: value, reason, type }=event;
    const dayId=value?.dayId ?? old?.dayId ?? null;
    let op;
    if(type==='draftCreated' || type==='draftUpdated') op=command('draft_save',dayId,{id:value.id,document:value.document,expectedVersion:old?.version,reason});
    else if(type==='draftArchived') op=command('draft_cancel',dayId,{id:value.id,expectedVersion:old.version,reason});
    else if(type==='draftConfirmed') continue; // sale_create converte a anotação atomicamente.
    else if(type==='saleCreated') {
      const draft=before.business.drafts.find(d=>d.id===value.id);
      op=command('sale_create',dayId,{id:value.id,movementId:value.movementId,sale:saleDocument(value),createdAt:value.createdAt,...(draft?{draftVersion:draft.version}:{})});
    } else if(type==='saleEdited' || type==='saleCanceled') {
      const day=next.days.find(d=>d.id===dayId), reversal=day.movements.find(m=>m.reverses===old.movementId);
      op=command(type==='saleEdited'?'sale_correct':'sale_cancel',dayId,{id:value.id,expectedVersion:old.entityVersion ?? 1,reason,reversalId:reversal.id,...(type==='saleEdited'?{movementId:value.movementId,sale:saleDocument(value)}:{})});
    } else if(type==='saleUpdated') op=command('sale_update',dayId,{id:value.id,expectedVersion:old.entityVersion ?? 1,reason,customer:value.customer,address:value.address,notes:value.notes,posted:value.posted,delivery:deliveryToServer(value.delivery)});
    else if(type==='receiptCreated') op=command('receipt_create',dayId,{...value,createdAt:value.createdAt});
    else if(type==='receiptReversed') {
      const reversal=next.days.find(d=>d.id===dayId).movements.find(m=>m.reverses===old.movementId);
      op=command('receipt_reverse',dayId,{id:value.id,expectedVersion:old.entityVersion ?? 1,reason,reversalId:reversal.id});
    } else if(type==='benefitPriceChanged') op=command('benefit_price',null,{amount:value,expectedVersion:before.business.settingsVersion ?? 1});
    else if(type==='smallNotesChanged') op=command('small_notes',event.entityId,{needed:value,reason});
    else throw new Error('Operação ainda não suportada pela sincronização: '+type);
    if (op) result.push(op);
    if(type.startsWith('sale') && value?.id) {
      const sale=next.business.sales.find(s=>s.id===value.id); if(sale) sale.entityVersion=old ? (old.entityVersion ?? 1)+1 : 1;
    }
    if(type.startsWith('receipt') && value?.id) {
      const receipt=next.business.receipts.find(r=>r.id===value.id); if(receipt) receipt.entityVersion=old ? (old.entityVersion ?? 1)+1 : 1;
    }
    if(type==='benefitPriceChanged') next.business.settingsVersion=(before.business.settingsVersion ?? 1)+1;
  }
  return result;
}
export function appendOutbox(before,next) {
  if(!before.remote?.enabled) return next;
  if(before.remote.reconciling)throw new Error('Aguarde a reconciliação da fila terminar antes de lançar.');
  if(before.remote.importing)throw new Error('Aguarde a primeira importação terminar antes de alterar os registros. Sua cópia original está preservada.');
  if(before.remote.closeRequest)throw new Error('Há um fechamento em andamento. Aguarde ou aborte a preparação antes de lançar.');
  const operations=commandsForChange(before,next);
  for(const op of operations)if(!['sale_update','draft_save','draft_cancel','benefit_price'].includes(op.type) && before.days.find(d=>d.id===op.dayId)?.remoteStatus==='closing')throw new Error('Caixa em preparação de fechamento. Novos lançamentos financeiros estão bloqueados.');
  next.remote=structuredClone(before.remote);
  next.remote.queue.push(...operations.map(cmd=>({id:crypto.randomUUID(),command:JSON.parse(JSON.stringify(cmd)),state:'pending',attempts:0,createdAt:new Date().toISOString(),actorId:before.remote.userId})));
  return next;
}

// A importação automática aceita apenas fatos simples de caixa aberto.
// Histórico corrigido/fechado exige reconciliação separada, nunca replay cego.
export function initialImportPlan(state) {
  if(state.days.some(d=>d.closing)) throw new Error('Há caixas fechados. Exporte a cópia: a importação histórica precisa de conferência antes de sincronizar.');
  if(state.business.events.some(e=>!['saleCreated','receiptCreated','draftCreated','draftUpdated','draftConfirmed','smallNotesChanged','benefitPriceChanged'].includes(e.type))) throw new Error('Há correções ou estornos no histórico local. A importação precisa de conferência.');
  if(state.business.sales.some(s=>s.canceled) || state.business.receipts.some(r=>r.reversed) || state.days.some(d=>d.movements.some(m=>m.type==='reversal'))) throw new Error('Há estornos locais que precisam de conferência.');
  const commands=[];
  for(const day of state.days) commands.push(command('open_day',day.id,{id:day.id,date:day.date,initialCash:day.initialCash,initialFund:day.initialFund,notes:day.notes,createdAt:day.createdAt}));
  if(state.business.benefitPrice!==10798 && state.business.sales.length) throw new Error('Há preços históricos de benefício: a importação precisa de conferência.');
  const timeline=[];
  for(const day of state.days) for(const m of day.movements) if(!m.commerceId) timeline.push({time:m.createdAt,cmd:movementCommand(m)});
  for(const sale of state.business.sales) {
    if(sale.benefitPrice!==10798) throw new Error('Preço histórico exige conferência.');
    timeline.push({time:sale.createdAt,cmd:command('sale_create',sale.dayId,{id:sale.id,movementId:sale.movementId,sale:saleDocument(sale),createdAt:sale.createdAt})});
  }
  for(const r of state.business.receipts) timeline.push({time:r.createdAt,cmd:command('receipt_create',r.dayId,{...r})});
  timeline.sort((a,b)=>a.time.localeCompare(b.time)); commands.push(...timeline.map(x=>x.cmd));
  for(const draft of state.business.drafts.filter(d=>d.status==='draft')) commands.push(command('draft_save',draft.dayId,{id:draft.id,document:draft.document}));
  if(state.business.benefitPrice!==10798)commands.push(command('benefit_price',null,{amount:state.business.benefitPrice,expectedVersion:1}));
  for(const day of state.days)if(day.smallNotesNeeded)commands.push(command('small_notes',day.id,{needed:true,reason:'Importação conferida do alerta local'}));
  return commands;
}
