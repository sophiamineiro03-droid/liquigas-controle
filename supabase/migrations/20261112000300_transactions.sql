begin;
create function private.open_day(p_unit uuid,p_day uuid) returns public.cash_days language plpgsql set search_path='' as $$
declare d public.cash_days; begin
 select * into d from public.cash_days where unit_id=p_unit and id=p_day for update;
 if not found or d.status<>'open' then raise exception using errcode='P0001',message='LC_CASH_NOT_OPEN'; end if;
 return d; end $$;
create function private.audit(p_unit uuid,p_device uuid,p_op uuid,p_kind text,p_id text,p_type text,p_reason text,p_before jsonb,p_after jsonb) returns void language sql set search_path='' as $$
 insert into public.audit_events(unit_id,device_id,operation_id,actor_id,entity_type,entity_id,event_type,reason,before_data,after_data)
 values(p_unit,p_device,p_op,auth.uid(),p_kind,p_id,p_type,private.txt(p_reason,'reason'),p_before,p_after)
$$;
create function private.append_movement(p_unit uuid,p_day uuid,p_id uuid,p_type text,p_description text,p_entries jsonb,p_sale uuid default null,p_receipt uuid default null,p_reverse uuid default null,p_notes text default '',p_legacy_amount bigint default null,p_legacy_received bigint default null) returns uuid language plpgsql set search_path='' as $$
declare e jsonb; n integer:=0; begin
 perform private.open_day(p_unit,p_day);
 insert into public.financial_movements(id,unit_id,day_id,type,description,notes,actor_id,sale_id,receipt_id,reverses,legacy_sale_amount,legacy_received) values(p_id,p_unit,p_day,p_type,private.txt(p_description,'description'),private.txt(p_notes,'notes',false),auth.uid(),p_sale,p_receipt,p_reverse,p_legacy_amount,p_legacy_received);
 for e in select value from jsonb_array_elements(p_entries) loop
  n:=n+1;
  insert into public.movement_entries(id,unit_id,movement_id,line_no,from_account,to_account,amount,kind) values(coalesce((e->>'id')::uuid,gen_random_uuid()),p_unit,p_id,n,(e->>'from')::private.cash_account,(e->>'to')::private.cash_account,private.money(e->'amount',true),e->>'kind');
 end loop;
 perform private.assert_balances(p_unit,p_day);
 return p_id;
end $$;
create function private.reverse_movement(p_unit uuid,p_day uuid,p_original uuid,p_new uuid,p_reason text,p_commerce boolean default false) returns uuid language plpgsql set search_path='' as $$
declare m public.financial_movements; entries jsonb; begin
 perform private.open_day(p_unit,p_day);
 select * into m from public.financial_movements where unit_id=p_unit and id=p_original and day_id=p_day;
 if not found or m.type='reversal' or (not p_commerce and (m.sale_id is not null or m.receipt_id is not null)) then raise exception using errcode='22023',message='LC_INVALID_REVERSAL_TARGET'; end if;
 if exists(select 1 from public.financial_movements where unit_id=p_unit and reverses=p_original) then raise exception using errcode='P0001',message='LC_ALREADY_REVERSED'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('from',to_account,'to',from_account,'amount',amount,'kind',kind) order by line_no),'[]') into entries from public.movement_entries where unit_id=p_unit and movement_id=p_original;
 return private.append_movement(p_unit,p_day,p_new,'reversal',p_reason,entries,null,null,p_original);
end $$;
create function private.save_sale_version(p_unit uuid,p_day uuid,p_sale uuid,p_revision integer,p_mov uuid,p_doc jsonb,p_reason text) returns void language plpgsql set search_path='' as $$
declare entries jsonb:='[]'; x jsonb; n integer:=0; begin
 if (p_doc->>'tendered')::bigint>0 then entries:=entries||jsonb_build_array(jsonb_build_object('from','external','to','cash','amount',p_doc->'tendered','kind','saleReceipt')); end if;
 if (p_doc->>'change')::bigint>0 then entries:=entries||jsonb_build_array(jsonb_build_object('from',p_doc->>'changeFrom','to','external','amount',p_doc->'change','kind','saleChange')); end if;
 perform private.append_movement(p_unit,p_day,p_mov,'operationalSale','Venda: '||(p_doc->>'customer'),entries,p_sale);
 insert into public.sale_versions(unit_id,sale_id,revision,movement_id,benefit_price,cash_amount,tendered,change_amount,change_from,original_document,reason,actor_id)
 values(p_unit,p_sale,p_revision,p_mov,(p_doc->>'benefitPrice')::bigint,(p_doc->>'cash')::bigint,(p_doc->>'tendered')::bigint,(p_doc->>'change')::bigint,(p_doc->>'changeFrom')::private.cash_account,p_doc,private.txt(p_reason,'reason'),auth.uid());
 for x in select value from jsonb_array_elements(p_doc->'items') loop
  n:=n+1; insert into public.sale_items(id,unit_id,sale_id,revision,line_no,product,category,quantity,total,benefit) values((x->>'id')::uuid,p_unit,p_sale,p_revision,n,x->>'product',(x->>'category')::private.category,(x->>'quantity')::integer,(x->>'total')::bigint,(x->>'benefit')::boolean);
 end loop;
 n:=0;
 for x in select value from jsonb_array_elements(p_doc->'payments') loop
  n:=n+1; insert into public.payment_allocations(id,unit_id,sale_id,revision,line_no,category,method,amount) values((x->>'id')::uuid,p_unit,p_sale,p_revision,n,(x->>'category')::private.category,(x->>'method')::private.payment_method,(x->>'amount')::bigint);
 end loop;
 x:=p_doc->'fee';
 if x<>'null'::jsonb then insert into public.delivery_fees(id,unit_id,sale_id,revision,amount,method,initial_status) values((x->>'id')::uuid,p_unit,p_sale,p_revision,(x->>'amount')::bigint,(x->>'method')::private.payment_method,x->>'status'); end if;
end $$;
create function private.assert_sale_version() returns trigger language plpgsql security definer set search_path='' as $$
declare v public.sale_versions; gas bigint; water bigint; bg bigint; pa_gas bigint; pa_water bigint; pb bigint; cash bigint; cnt integer; fee public.delivery_fees; begin
 select * into v from public.sale_versions where unit_id=new.unit_id and sale_id=new.sale_id and revision=new.revision;
 select count(*),coalesce(sum(total) filter(where category='gas'),0),coalesce(sum(total) filter(where category='water'),0),coalesce(sum(total) filter(where benefit),0) into cnt,gas,water,bg from public.sale_items where unit_id=v.unit_id and sale_id=v.sale_id and revision=v.revision;
 if cnt not between 1 and 30 or exists(select 1 from public.sale_items where unit_id=v.unit_id and sale_id=v.sale_id and revision=v.revision and benefit and (product<>'p13' or total::numeric<>quantity::numeric*v.benefit_price::numeric)) then raise exception using errcode='23514',message='LC_INVALID_VERSION_ITEMS'; end if;
 select count(*),coalesce(sum(amount) filter(where category='gas'),0),coalesce(sum(amount) filter(where category='water'),0),coalesce(sum(amount) filter(where method='benefit'),0),coalesce(sum(amount) filter(where method='cash'),0) into cnt,pa_gas,pa_water,pb,cash from public.payment_allocations where unit_id=v.unit_id and sale_id=v.sale_id and revision=v.revision;
 if cnt not between 1 and 30 or gas<>pa_gas or water<>pa_water or bg<>pb then raise exception using errcode='23514',message='LC_INVALID_VERSION_PAYMENTS'; end if;
 select * into fee from public.delivery_fees where unit_id=v.unit_id and sale_id=v.sale_id and revision=v.revision;
 if found then
  if bg=0 then raise exception using errcode='23514',message='LC_FEE_REQUIRES_BENEFIT'; end if;
  if fee.initial_status='paid' and fee.method='cash' then cash:=cash+fee.amount; end if;
 end if;
 if cash<>v.cash_amount or gas+water+coalesce(fee.amount::bigint,0)>999999999999 then raise exception using errcode='23514',message='LC_INVALID_VERSION_CASH'; end if;
 return null;
end $$;
do $$ declare t text; begin foreach t in array array['sale_versions','sale_items','payment_allocations','delivery_fees'] loop
 execute format('create constraint trigger validate_version after insert on public.%I deferrable initially deferred for each row execute function private.assert_sale_version()',t);
end loop; end $$;

create function private.sale_snapshot(p_unit uuid,p_sale uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('financial',v.original_document,'delivery',to_jsonb(d))
 from public.sales s join public.sale_versions v on v.unit_id=s.unit_id and v.sale_id=s.id and v.revision=s.current_revision
 join public.deliveries d on d.unit_id=s.unit_id and d.sale_id=s.id where s.unit_id=p_unit and s.id=p_sale
$$;

-- Um comando financeiro sempre é serializado pelo lock da unidade no gateway.
create function private.dispatch(p_unit uuid,p_device uuid,p_op uuid,p_command jsonb) returns jsonb language plpgsql set search_path='' as $$
declare draft public.sale_drafts; typ text:=p_command->>'type'; p jsonb:=p_command->'data'; day uuid:=(p_command->>'dayId')::uuid;
 d public.cash_days; s public.sales; receipt public.debt_receipts; version public.sale_versions;
 doc jsonb; before_doc jsonb; after_doc jsonb; entries jsonb:='[]'; mov uuid; reversal uuid; entity uuid;
 amount bigint; received bigint; change bigint; price bigint; direction text; from_a text; to_a text; account text;
 category text; target text; customer text; method text; reason text; snapshot jsonb; round uuid; dev record;
 key text; counted_cash bigint; counted_fund bigint; expected_cash bigint; expected_fund bigint;
begin
 if typ in ('draft_save','draft_cancel') then
  perform private.require_permission(p_unit,'sale_write'); entity:=private.id(p,'id');
  if day is not null and not exists(select 1 from public.cash_days where id=day and unit_id=p_unit) then raise exception using errcode='22023',message='LC_INVALID_DRAFT_DAY'; end if;
  select * into draft from public.sale_drafts where id=entity and unit_id=p_unit for update;
  if found then
   if draft.status<>'draft' or (p->>'expectedVersion')::bigint is distinct from draft.entity_version then raise exception using errcode='P0001',message='LC_DRAFT_VERSION_CONFLICT'; end if;
   before_doc:=to_jsonb(draft);
   update public.sale_drafts set document=case when typ='draft_cancel' then document else p->'document' end,status=case when typ='draft_cancel' then 'canceled' else 'draft' end,entity_version=entity_version+1,updated_at=now() where unit_id=p_unit and id=entity;
  else
   if typ='draft_cancel' then raise exception using errcode='P0001',message='LC_DRAFT_NOT_FOUND'; end if;
   if exists(select 1 from public.sales where id=entity) then raise exception using errcode='P0001',message='LC_SALE_ID_EXISTS'; end if;
   insert into public.sale_drafts(id,unit_id,origin_day_id,document,created_by) values(entity,p_unit,day,p->'document',auth.uid());
  end if;
  select to_jsonb(x) into after_doc from public.sale_drafts x where unit_id=p_unit and id=entity;
  perform private.audit(p_unit,p_device,p_op,'draft',entity::text,typ,coalesce(nullif(p->>'reason',''),'Anotação em rascunho'),before_doc,after_doc);
  return jsonb_build_object('draftId',entity,'entityVersion',after_doc->'entity_version','status',after_doc->'status');
 elsif typ='open_day' then
  perform private.require_permission(p_unit,'cash_write'); entity:=private.id(p,'id');
  if entity is distinct from day then raise exception using errcode='22023',message='LC_DAY_ID_MISMATCH'; end if;
  insert into public.cash_days(id,unit_id,business_date,initial_cash,initial_fund,notes,opened_by,client_created_at) values(entity,p_unit,(p->>'date')::date,private.money(p->'initialCash'),private.money(p->'initialFund'),private.txt(p->>'notes','notes',false),auth.uid(),(p->>'createdAt')::timestamptz);
  perform private.audit(p_unit,p_device,p_op,'cash_day',day::text,typ,'Abertura de caixa',null,to_jsonb((select x from public.cash_days x where id=day)));
  return jsonb_build_object('dayId',day,'physical',private.cash_summary(p_unit,day),'financialVersion',0);
 elsif typ in ('movement','movement_reverse') then
  perform private.require_permission(p_unit,'cash_write'); d:=private.open_day(p_unit,day);
  if typ='movement_reverse' then
   entity:=private.reverse_movement(p_unit,day,private.id(p,'movementId'),private.id(p,'id'),private.txt(p->>'reason','reason'));
  else
   entity:=private.id(p,'id'); reason:=private.txt(p->>'description','description'); typ:=p->>'type';
   amount:=private.money(p->'amount',true);
   if typ='income' then account:=p->>'account'; from_a:='external'; to_a:=account;
   elsif typ='expense' then account:=p->>'account'; from_a:=account; to_a:='external';
   elsif typ='adjustment' then
    account:=p->>'account'; direction:=p->>'direction';
    if direction is null or direction not in ('increase','decrease') then raise exception using errcode='22023',message='LC_INVALID_ADJUSTMENT'; end if;
    from_a:=case when direction='increase' then 'external' else account end; to_a:=case when direction='increase' then account else 'external' end;
   elsif typ in ('transfer','replenish') then
    from_a:=case when typ='replenish' then 'cash' else p->>'from' end;
    to_a:=case when typ='replenish' then 'fund' else p->>'to' end;
    if from_a is null or to_a is null or from_a not in ('cash','fund') or to_a not in ('cash','fund') then raise exception using errcode='22023',message='LC_INVALID_TRANSFER'; end if;
   elsif typ='sale' then
    received:=private.money(p->'received',true); change:=received-amount;
    if change<0 then raise exception using errcode='22023',message='LC_CASH_NOT_ENOUGH'; end if;
    entries:=jsonb_build_array(jsonb_build_object('from','external','to','cash','amount',received,'kind','saleReceipt'));
    if change>0 then entries:=entries||jsonb_build_array(jsonb_build_object('from','fund','to','external','amount',change,'kind','saleChange')); end if;
   else raise exception using errcode='22023',message='LC_INVALID_MOVEMENT_TYPE'; end if;
   if typ<>'sale' then
    if from_a is null or to_a is null or from_a=to_a or (typ in ('income','expense','adjustment') and (account is null or account not in ('cash','fund'))) then raise exception using errcode='22023',message='LC_INVALID_ACCOUNT'; end if;
    entries:=jsonb_build_array(jsonb_build_object('from',from_a,'to',to_a,'amount',amount,'kind',case when typ in ('transfer','replenish') then 'transfer' else typ end));
   end if;
   perform private.append_movement(p_unit,day,entity,typ,reason,entries,null,null,null,private.txt(p->>'notes','notes',false),case when typ='sale' then amount end,case when typ='sale' then received end);
  end if;
  update public.cash_days set financial_version=financial_version+1 where unit_id=p_unit and id=day;
  perform private.audit(p_unit,p_device,p_op,'movement',entity::text,p_command->>'type',coalesce(p->>'reason',p->>'description'),null,jsonb_build_object('movementId',entity));
  return jsonb_build_object('movementId',entity,'physical',private.cash_summary(p_unit,day));
 elsif typ in ('sale_create','sale_correct','sale_cancel','sale_update') then
  perform private.require_permission(p_unit,case when typ='sale_update' then 'delivery_write' else 'sale_write' end);
  entity:=private.id(p,'id');
  if typ='sale_create' then
   select * into draft from public.sale_drafts where unit_id=p_unit and id=entity for update;
   if found and (draft.status<>'draft' or (p->>'draftVersion')::bigint is distinct from draft.entity_version) then raise exception using errcode='P0001',message='LC_DRAFT_VERSION_CONFLICT'; end if;
   d:=private.open_day(p_unit,day); select benefit_price into price from public.unit_settings where unit_id=p_unit;
   doc:=private.normalize_sale(p->'sale',price);
   insert into public.sales(id,unit_id,day_id,customer,address,notes,posted,created_by,client_created_at) values(entity,p_unit,day,doc->>'customer',doc->'address',doc->>'notes',(doc->>'posted')::boolean,auth.uid(),(p->>'createdAt')::timestamptz);
   mov:=coalesce((p->>'movementId')::uuid,gen_random_uuid());
   perform private.save_sale_version(p_unit,day,entity,1,mov,doc,'Cadastro de venda');
   insert into public.deliveries(id,unit_id,sale_id,driver,driver_other,status) values(coalesce((p->>'deliveryId')::uuid,gen_random_uuid()),p_unit,entity,doc#>>'{delivery,driver}',doc#>>'{delivery,driverOther}',doc#>>'{delivery,status}');
   if draft.id is not null then
    update public.sale_drafts set status='converted',converted_sale_id=entity,entity_version=entity_version+1,updated_at=now() where unit_id=p_unit and id=entity;
   end if;
   reason:='Cadastro de venda';
  else
   select * into s from public.sales where unit_id=p_unit and id=entity and day_id=day for update;
   if not found or s.canceled then raise exception using errcode='P0001',message='LC_SALE_NOT_ACTIVE'; end if;
   if (p->>'expectedVersion')::bigint is distinct from s.entity_version then raise exception using errcode='P0001',message='LC_ENTITY_VERSION_CONFLICT'; end if;
   reason:=private.txt(p->>'reason','reason');
   select * into version from public.sale_versions where unit_id=p_unit and sale_id=entity and revision=s.current_revision;
   before_doc:=private.sale_snapshot(p_unit,entity);
   if typ='sale_update' then
    select jsonb_build_object('driver',driver,'driverOther',driver_other,'status',status) into doc from public.deliveries where unit_id=p_unit and sale_id=entity;
    doc:=private.delivery(doc||coalesce(p->'delivery','{}'::jsonb));
    after_doc:=s.address;
    if p ? 'address' then
     if jsonb_typeof(p->'address')<>'object' then raise exception using errcode='22023',message='LC_INVALID_ADDRESS'; end if;
     foreach key in array array['district','street','number','extra','reference'] loop
      if (p->'address') ? key then after_doc:=after_doc||jsonb_build_object(key,private.txt(p#>>array['address',key],key,false,200)); end if;
     end loop;
    end if;
    update public.sales set customer=case when p ? 'customer' then private.txt(p->>'customer','customer',false,100) else s.customer end,address=after_doc,notes=case when p ? 'notes' then private.txt(p->>'notes','notes',false) else s.notes end,posted=case when p ? 'posted' then private.flag(p->'posted') else s.posted end,entity_version=entity_version+1,updated_at=now() where unit_id=p_unit and id=entity;
    update public.deliveries set driver=doc->>'driver',driver_other=doc->>'driverOther',status=doc->>'status',entity_version=entity_version+1,updated_at=now() where unit_id=p_unit and sale_id=entity;
   else
    d:=private.open_day(p_unit,day);
    if exists(select 1 from public.debt_receipts where unit_id=p_unit and sale_id=entity and reversed_by is null) then raise exception using errcode='P0001',message='LC_ACTIVE_RECEIPTS'; end if;
    reversal:=private.reverse_movement(p_unit,day,version.movement_id,coalesce((p->>'reversalId')::uuid,gen_random_uuid()),reason,true);
    if typ='sale_cancel' then
     update public.sales set canceled=true,canceled_at=now(),entity_version=entity_version+1,updated_at=now() where unit_id=p_unit and id=entity;
     update public.deliveries set status='canceled',entity_version=entity_version+1,updated_at=now() where unit_id=p_unit and sale_id=entity;
    else
     doc:=private.normalize_sale(p->'sale',version.benefit_price);
     mov:=coalesce((p->>'movementId')::uuid,gen_random_uuid());
     perform private.save_sale_version(p_unit,day,entity,s.current_revision+1,mov,doc,reason);
     update public.sales set current_revision=current_revision+1,entity_version=entity_version+1,customer=doc->>'customer',address=doc->'address',notes=doc->>'notes',posted=(doc->>'posted')::boolean,updated_at=now() where unit_id=p_unit and id=entity;
     update public.deliveries set driver=doc#>>'{delivery,driver}',driver_other=doc#>>'{delivery,driverOther}',status=doc#>>'{delivery,status}',entity_version=entity_version+1,updated_at=now() where unit_id=p_unit and sale_id=entity;
    end if;
   end if;
  end if;
  if typ<>'sale_update' then update public.cash_days set financial_version=financial_version+1 where unit_id=p_unit and id=day; end if;
  after_doc:=private.sale_snapshot(p_unit,entity);
  perform private.audit(p_unit,p_device,p_op,'sale',entity::text,typ,reason,before_doc,after_doc);
  return jsonb_build_object('saleId',entity,'entityVersion',after_doc->'entity_version','movementId',mov,'reversalId',reversal,'physical',private.cash_summary(p_unit,day));
 elsif typ in ('receipt_create','receipt_reverse') then
  perform private.require_permission(p_unit,'receipt_write'); d:=private.open_day(p_unit,day); entity:=private.id(p,'id');
  if typ='receipt_create' then
   amount:=private.money(p->'amount',true); method:=p->>'method';
   if method is null or method not in ('cash','pix','debit','credit') then raise exception using errcode='22023',message='LC_INVALID_RECEIPT_METHOD'; end if;
   if nullif(p->>'saleId','') is not null then
    select * into s from public.sales where unit_id=p_unit and id=(p->>'saleId')::uuid and not canceled;
    if not found then raise exception using errcode='P0001',message='LC_SALE_NOT_ACTIVE'; end if;
    target:=p->>'target';
    if target is null or target not in ('gas','water','fee') then raise exception using errcode='22023',message='LC_INVALID_RECEIPT_TARGET'; end if;
    if amount>coalesce((private.sale_due(p_unit,s.id)->>target)::bigint,0) then raise exception using errcode='P0001',message='LC_OVERPAYMENT'; end if;
    category:=case when target='fee' then 'gas' else target end; customer:=s.customer;
   else category:=p->>'category'; customer:=private.txt(p->>'customer','customer',true,100); end if;
   if category is null or category not in ('gas','water') then raise exception using errcode='22023',message='LC_INVALID_CATEGORY'; end if;
   mov:=coalesce((p->>'movementId')::uuid,gen_random_uuid());
   insert into public.debt_receipts(id,unit_id,day_id,sale_id,sale_revision,target,category,customer,amount,method,notes,movement_id,actor_id,client_created_at) values(entity,p_unit,day,s.id,s.current_revision,target,category::private.category,customer,amount,method::private.payment_method,private.txt(p->>'notes','notes',false),mov,auth.uid(),(p->>'createdAt')::timestamptz);
   if method='cash' then entries:=jsonb_build_array(jsonb_build_object('from','external','to','cash','amount',amount,'kind','debtReceipt')); end if;
   perform private.append_movement(p_unit,day,mov,'debtReceipt','Recebimento: '||customer,entries,null,entity);
   reason:='Recebimento de dívida';
  else
   select * into receipt from public.debt_receipts where unit_id=p_unit and id=entity and day_id=day for update;
   if not found or receipt.reversed_by is not null then raise exception using errcode='P0001',message='LC_RECEIPT_NOT_ACTIVE'; end if;
   if (p->>'expectedVersion')::bigint is distinct from receipt.entity_version then raise exception using errcode='P0001',message='LC_ENTITY_VERSION_CONFLICT'; end if;
   reason:=private.txt(p->>'reason','reason'); before_doc:=to_jsonb(receipt);
   reversal:=private.reverse_movement(p_unit,day,receipt.movement_id,coalesce((p->>'reversalId')::uuid,gen_random_uuid()),reason,true);
   update public.debt_receipts set reversed_by=reversal,reversed_at=now(),entity_version=entity_version+1 where unit_id=p_unit and id=entity;
  end if;
  update public.cash_days set financial_version=financial_version+1 where unit_id=p_unit and id=day;
  select to_jsonb(x) into after_doc from public.debt_receipts x where unit_id=p_unit and id=entity;
  perform private.audit(p_unit,p_device,p_op,'receipt',entity::text,typ,reason,before_doc,after_doc);
  return jsonb_build_object('receiptId',entity,'entityVersion',after_doc->'entity_version','physical',private.cash_summary(p_unit,day));
 elsif typ='benefit_price' then
  perform private.require_permission(p_unit,'settings_write');
  select to_jsonb(x) into before_doc from public.unit_settings x where unit_id=p_unit;
  if (p->>'expectedVersion')::bigint is distinct from (before_doc->>'entity_version')::bigint then raise exception using errcode='P0001',message='LC_ENTITY_VERSION_CONFLICT'; end if;
  price:=private.money(p->'amount',true);
  update public.unit_settings set benefit_price=price,entity_version=entity_version+1 where unit_id=p_unit;
  perform private.audit(p_unit,p_device,p_op,'setting','benefitPrice',typ,'Alteração de valor para novas vendas',before_doc,jsonb_build_object('benefitPrice',price));
  return jsonb_build_object('benefitPrice',price);
 elsif typ='small_notes' then
  perform private.require_permission(p_unit,'cash_write'); d:=private.open_day(p_unit,day);
  update public.cash_days set small_notes_needed=private.flag(p->'needed') where unit_id=p_unit and id=day;
  perform private.audit(p_unit,p_device,p_op,'cash_day',day::text,typ,private.txt(p->>'reason','reason'),to_jsonb(d.small_notes_needed),p->'needed');
  return jsonb_build_object('physical',private.cash_summary(p_unit,day));
 elsif typ in ('close_prepare','close_ack','close_commit','close_abort') then
  perform private.require_permission(p_unit,case when typ='close_ack' then 'cash_write' else 'close' end);
  select * into d from public.cash_days where unit_id=p_unit and id=day for update;
  if not found then raise exception using errcode='P0001',message='LC_CASH_NOT_FOUND'; end if;
  if typ='close_prepare' then
   if d.status<>'open' then raise exception using errcode='P0001',message='LC_CASH_NOT_OPEN'; end if;
   if exists(select 1 from public.device_pending_operations where unit_id=p_unit and day_id=day and status='pending') then raise exception using errcode='P0001',message='LC_PENDING_OPERATIONS'; end if;
   round:=gen_random_uuid();
   update public.cash_days set status='closing',close_round_id=round,close_base_version=financial_version where unit_id=p_unit and id=day;
   insert into public.close_acknowledgments(unit_id,day_id,round_id,device_id) select p_unit,day,round,id from public.devices where unit_id=p_unit and active;
   perform private.audit(p_unit,p_device,p_op,'cash_day',day::text,typ,'Preparação de fechamento',to_jsonb(d),jsonb_build_object('roundId',round));
   return jsonb_build_object('roundId',round,'financialVersion',d.financial_version,'expected',private.cash_summary(p_unit,day));
  end if;
  round:=private.id(p,'roundId');
  if d.status<>'closing' or d.close_round_id<>round then raise exception using errcode='P0001',message='LC_CLOSE_ROUND_CONFLICT'; end if;
  if typ='close_abort' then
   reason:=private.txt(p->>'reason','reason');
   update public.cash_days set status='open',close_round_id=null,close_base_version=null where unit_id=p_unit and id=day;
   perform private.audit(p_unit,p_device,p_op,'cash_day',day::text,typ,reason,to_jsonb(d),null);
   return jsonb_build_object('status','open');
  end if;
  if exists(select 1 from public.device_pending_operations where unit_id=p_unit and day_id=day and status='pending') then raise exception using errcode='P0001',message='LC_PENDING_OPERATIONS'; end if;
  if typ='close_ack' then
   select * into dev from public.devices where unit_id=p_unit and id=p_device;
   if (p->>'manifestGeneration')::bigint is distinct from dev.manifest_generation or dev.manifest_hash is null then raise exception using errcode='P0001',message='LC_MANIFEST_REQUIRED'; end if;
   update public.close_acknowledgments set manifest_generation=dev.manifest_generation,acknowledged_at=now() where unit_id=p_unit and round_id=round and device_id=p_device;
   if not found then raise exception using errcode='P0001',message='LC_DEVICE_NOT_IN_ROUND'; end if;
   return jsonb_build_object('acknowledged',true,'roundId',round);
  end if;
  if (p->>'financialVersion')::bigint is distinct from d.close_base_version or d.financial_version<>d.close_base_version then raise exception using errcode='P0001',message='LC_FINANCIAL_VERSION_CONFLICT'; end if;
  if exists(select 1 from public.close_acknowledgments a join public.devices v on v.unit_id=a.unit_id and v.id=a.device_id where a.unit_id=p_unit and a.round_id=round and (a.acknowledged_at is null or a.manifest_generation<>v.manifest_generation or not v.active)) or exists(select 1 from public.devices v where v.unit_id=p_unit and v.active and not exists(select 1 from public.close_acknowledgments a where a.unit_id=p_unit and a.round_id=round and a.device_id=v.id)) then raise exception using errcode='P0001',message='LC_DEVICES_NOT_ACKNOWLEDGED'; end if;
  snapshot:=private.cash_summary(p_unit,day); expected_cash:=(snapshot->>'cash')::bigint; expected_fund:=(snapshot->>'fund')::bigint;
  counted_cash:=private.money(p->'countedCash'); counted_fund:=private.money(p->'countedFund'); reason:=private.txt(p->>'notes','notes',false);
  entity:=private.id(p,'id');
  insert into public.cash_closings(id,unit_id,day_id,round_id,expected_cash,expected_fund,counted_cash,counted_fund,expected,commercial_snapshot,financial_version,notes,actor_id) values(entity,p_unit,day,round,expected_cash,expected_fund,counted_cash,counted_fund,snapshot,private.commercial_report(p_unit,day),d.financial_version,reason,auth.uid());
  update public.cash_days set status='closed',close_round_id=null,close_base_version=null where unit_id=p_unit and id=day;
  perform private.audit(p_unit,p_device,p_op,'cash_day',day::text,typ,coalesce(nullif(reason,''),'Fechamento confirmado no servidor'),to_jsonb(d),jsonb_build_object('closingId',entity,'expected',snapshot));
  return jsonb_build_object('closingId',entity,'status','closed','expected',snapshot);
 else raise exception using errcode='22023',message='LC_UNKNOWN_COMMAND'; end if;
end $$;
commit;
