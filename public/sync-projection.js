import { deliveryFromServer } from './sync.js';
export function projectSnapshot(rows, previous) {
  const labels=new Map(rows.profiles.map(p=>[p.id,p.display_name]));
  const user=r=>r.legacy_user_label || labels.get(r.actor_id??r.created_by??r.opened_by) || 'Administradora';
  const synced={syncStatus:'confirmed'};
  const days=rows.cash_days.map(d=>({id:d.id,date:d.business_date,initialCash:d.initial_cash,initialFund:d.initial_fund,referenceFund:d.reference_fund,notes:d.notes,user:user(d),createdAt:d.client_created_at??d.created_at,smallNotesNeeded:d.small_notes_needed,remoteStatus:d.status,financialVersion:d.financial_version,closeRoundId:d.close_round_id,...synced,
    movements:rows.financial_movements.filter(m=>m.day_id===d.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(m=>({id:m.id,dayId:d.id,type:m.type,description:m.description,notes:m.notes,user:user(m),createdAt:m.client_created_at??m.created_at,...synced,...(m.reverses?{reverses:m.reverses}:{}),...(m.sale_id||m.receipt_id?{commerceId:m.sale_id??m.receipt_id}:{}),...(m.type==='sale'?{saleAmount:m.legacy_sale_amount,received:m.legacy_received}:{}),entries:rows.movement_entries.filter(e=>e.movement_id===m.id).sort((a,b)=>a.line_no-b.line_no).map(e=>({from:e.from_account,to:e.to_account,amount:e.amount,kind:e.kind}))})),
    closing:(()=>{const c=rows.cash_closings.find(c=>c.day_id===d.id);return c?{id:c.id,createdAt:c.client_created_at??c.created_at,user:user(c),notes:c.notes,countedCash:c.counted_cash,countedFund:c.counted_fund,expected:c.expected,commerce:c.commercial_snapshot,cashDifference:c.cash_difference,fundDifference:c.fund_difference,difference:c.difference,...synced}:null;})()
  }));
  const sales=rows.sales.map(s=>{
    const v=rows.sale_versions.find(v=>v.sale_id===s.id&&v.revision===s.current_revision);
    const d=rows.deliveries.find(d=>d.sale_id===s.id);
    if(!v||!d)throw new Error('Resposta incompleta de venda; sincronização pausada.');
    return {...v.original_document,id:s.id,dayId:s.day_id,customer:s.customer,address:s.address,notes:s.notes,posted:s.posted,canceled:s.canceled,canceledAt:s.canceled_at,createdAt:s.client_created_at??s.created_at,updatedAt:s.updated_at,user:user(s),movementId:v.movement_id,entityVersion:s.entity_version,delivery:deliveryFromServer({driver:d.driver,driverOther:d.driver_other,status:d.status}),...synced};
  });
  const receipts=rows.debt_receipts.map(r=>({id:r.id,dayId:r.day_id,saleId:r.sale_id,target:r.target,category:r.category,customer:r.customer,amount:r.amount,method:r.method,notes:r.notes,movementId:r.movement_id,reversed:!!r.reversed_by,reversedAt:r.reversed_at,entityVersion:r.entity_version,user:user(r),createdAt:r.client_created_at??r.created_at,...synced}));
  const drafts=rows.sale_drafts.map(d=>({id:d.id,dayId:d.origin_day_id,document:d.document,version:d.entity_version,status:d.status,saleId:d.converted_sale_id,user:user(d),createdAt:d.created_at,updatedAt:d.updated_at,...synced}));
  const events=rows.audit_events.map(e=>({id:e.id,type:({sale_create:'saleCreated',sale_correct:'saleEdited',sale_cancel:'saleCanceled',sale_update:'saleUpdated',draft_save:'draftUpdated',draft_cancel:'draftArchived',receipt_create:'receiptCreated',receipt_reverse:'receiptReversed'})[e.event_type]??e.event_type,entityId:e.entity_id,user:user(e),reason:e.reason,before:e.before_data,after:e.after_data,createdAt:e.created_at,...synced}));
  return {...previous,days,business:{schemaVersion:1,benefitPrice:rows.unit_settings[0]?.benefit_price??10798,settingsVersion:rows.unit_settings[0]?.entity_version??1,sales,receipts,drafts,events}};
}
