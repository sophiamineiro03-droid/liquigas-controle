begin;
create function private.has_permission(p_unit uuid,p_permission text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false) and exists(select 1 from public.unit_memberships m join private.role_permissions r on r.role=m.role where m.unit_id=p_unit and m.user_id=auth.uid() and m.active and r.permission=p_permission)
$$;
create function private.require_permission(p_unit uuid,p_permission text) returns void
language plpgsql set search_path='' as $$ begin
 if auth.uid() is null then raise exception using errcode='28000',message='LC_AUTH_REQUIRED'; end if;
 if not private.has_permission(p_unit,p_permission) then raise exception using errcode='42501',message='LC_PERMISSION_DENIED'; end if;
end $$;
create function private.hash(p_value jsonb) returns text language sql immutable set search_path='' as $$ select encode(sha256(convert_to(p_value::text,'UTF8')),'hex') $$;
create function private.txt(p_value text,p_label text,p_required boolean default true,p_max integer default 500) returns text
language plpgsql immutable set search_path='' as $$ begin
 if (p_required and length(btrim(coalesce(p_value,'')))=0) or length(coalesce(p_value,''))>p_max then raise exception using errcode='22023',message='LC_INVALID_TEXT: '||p_label; end if;
 return btrim(coalesce(p_value,'')); end $$;
create function private.money(p_value jsonb,p_positive boolean default false) returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric; begin
 if p_value is null or jsonb_typeof(p_value)<>'number' then raise exception using errcode='22023',message='LC_INVALID_CENTS'; end if;
 n:=p_value::text::numeric;
 if n<>trunc(n) or n<(case when p_positive then 1 else 0 end) or n>999999999999 then raise exception using errcode='22023',message='LC_INVALID_CENTS'; end if;
 return n::bigint; end $$;
create function private.flag(p_value jsonb,p_default boolean default false) returns boolean language plpgsql immutable set search_path='' as $$ begin
 if p_value is null then return p_default; end if;
 if jsonb_typeof(p_value)<>'boolean' then raise exception using errcode='22023',message='LC_INVALID_BOOLEAN'; end if;
 return p_value::text::boolean; end $$;
create function private.id(p_doc jsonb,p_key text) returns uuid language plpgsql immutable set search_path='' as $$ begin
 if nullif(p_doc->>p_key,'') is null then raise exception using errcode='22023',message='LC_MISSING_UUID: '||p_key; end if;
 return (p_doc->>p_key)::uuid; end $$;
create function private.delivery(p_doc jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare driver text:=p_doc->>'driver'; status text:=p_doc->>'status'; other text; begin
 if p_doc is not null and p_doc<>'null'::jsonb and jsonb_typeof(p_doc)<>'object' then raise exception using errcode='22023',message='LC_INVALID_DELIVERY'; end if;
 if (driver is not null and driver not in ('Wagner','Vinicius','Depósito','Outro')) or (status is not null and status not in ('awaiting','out','delivered','pickup','collected')) then raise exception using errcode='22023',message='LC_INVALID_DELIVERY'; end if;
 other:=private.txt(p_doc->>'driverOther','driverOther',false,100);
 return jsonb_build_object('driver',driver,'driverOther',other,'status',status); end $$;
create function private.normalize_sale(p_doc jsonb,p_price bigint) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; pay jsonb; items jsonb:='[]'; payments jsonb:='[]'; fee jsonb; address jsonb:='{}'; k text;
 gas bigint:=0; water bigint:=0; paid_gas bigint:=0; paid_water bigint:=0; cash bigint:=0; benefit_total bigint:=0; benefit_paid bigint:=0;
 product text; category text; method text; quantity numeric; amount bigint; benefited boolean; has_benefit boolean;
 tendered bigint; change_from text; d jsonb;
begin
 if jsonb_typeof(p_doc->'items') is distinct from 'array' or jsonb_array_length(p_doc->'items') not between 1 and 30 or jsonb_typeof(p_doc->'payments') is distinct from 'array' or jsonb_array_length(p_doc->'payments') not between 1 and 30 then raise exception using errcode='22023',message='LC_INVALID_LINES'; end if;
 select exists(select 1 from jsonb_array_elements(p_doc->'payments') p where p->>'method'='benefit') into has_benefit;
 for item in select value from jsonb_array_elements(p_doc->'items') loop
  product:=item->>'product';
  if product is null or product not in ('p13','p08','p45','water20','pack510') or jsonb_typeof(item->'quantity') is distinct from 'number' then raise exception using errcode='22023',message='LC_INVALID_PRODUCT_QUANTITY'; end if;
  quantity:=(item->>'quantity')::numeric;
  if quantity<>trunc(quantity) or quantity not between 1 and 99999 then raise exception using errcode='22023',message='LC_INVALID_QUANTITY'; end if;
  amount:=private.money(item->'total',true); category:=case when product in ('p13','p08','p45') then 'gas' else 'water' end;
  benefited:=private.flag(item->'benefit',has_benefit and product='p13');
  if benefited and (product<>'p13' or amount<>quantity*p_price) then raise exception using errcode='22023',message='LC_INVALID_BENEFIT_ITEM'; end if;
  if benefited then benefit_total:=benefit_total+amount; end if;
  if category='gas' then gas:=gas+amount; else water:=water+amount; end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',coalesce((item->>'id')::uuid,gen_random_uuid()),'product',product,'quantity',quantity::integer,'total',amount,'benefit',benefited,'category',category));
 end loop;
 for pay in select value from jsonb_array_elements(p_doc->'payments') loop
  category:=pay->>'category'; method:=pay->>'method'; amount:=private.money(pay->'amount',true);
  if category is null or category not in ('gas','water') or method is null or method not in ('cash','pix','debit','credit','creditSale','benefit') then raise exception using errcode='22023',message='LC_INVALID_PAYMENT'; end if;
  if method='benefit' and category<>'gas' then raise exception using errcode='22023',message='LC_INVALID_BENEFIT_PAYMENT'; end if;
  if category='gas' then paid_gas:=paid_gas+amount; else paid_water:=paid_water+amount; end if;
  if method='cash' then cash:=cash+amount; end if;
  if method='benefit' then benefit_paid:=benefit_paid+amount; end if;
  payments:=payments||jsonb_build_array(jsonb_build_object('id',coalesce((pay->>'id')::uuid,gen_random_uuid()),'category',category,'method',method,'amount',amount));
 end loop;
 if gas<>paid_gas or water<>paid_water then raise exception using errcode='22023',message='LC_PAYMENT_TOTAL_MISMATCH'; end if;
 if benefit_total<>benefit_paid then raise exception using errcode='22023',message='LC_BENEFIT_TOTAL_MISMATCH'; end if;
 d:=private.delivery(p_doc->'delivery');
 fee:=null;
 if p_doc->'fee' is not null and p_doc->'fee'<>'null'::jsonb then
  amount:=private.money(p_doc#>'{fee,amount}');
  if amount>0 then
   method:=p_doc#>>'{fee,method}';
   if benefit_paid=0 or method is null or method not in ('cash','pix','debit','credit','creditSale') or p_doc#>>'{fee,status}' is null or p_doc#>>'{fee,status}' not in ('paid','pending') or (method='creditSale' and p_doc#>>'{fee,status}'<>'pending') or d->>'driver'='Depósito' then raise exception using errcode='22023',message='LC_INVALID_FEE'; end if;
   fee:=jsonb_build_object('id',coalesce((p_doc#>>'{fee,id}')::uuid,gen_random_uuid()),'amount',amount,'method',method,'status',p_doc#>>'{fee,status}');
   if method='cash' and fee->>'status'='paid' then cash:=cash+amount; end if;
  end if;
 end if;
 if gas+water+coalesce((fee->>'amount')::bigint,0)>999999999999 then raise exception using errcode='22023',message='LC_AMOUNT_LIMIT'; end if;
 if cash=0 and coalesce(private.money(coalesce(p_doc->'tendered','0')),0)>0 then raise exception using errcode='22023',message='LC_UNEXPECTED_CASH'; end if;
 tendered:=case when cash=0 then 0 else private.money(coalesce(p_doc->'tendered',to_jsonb(cash))) end;
 if tendered<cash then raise exception using errcode='22023',message='LC_CASH_NOT_ENOUGH'; end if;
 change_from:=coalesce(p_doc->>'changeFrom','fund');
 if change_from not in ('cash','fund') then raise exception using errcode='22023',message='LC_INVALID_CHANGE_ACCOUNT'; end if;
 if p_doc->'address' is not null and p_doc->'address'<>'null'::jsonb and jsonb_typeof(p_doc->'address')<>'object' then raise exception using errcode='22023',message='LC_INVALID_ADDRESS'; end if;
 foreach k in array array['district','street','number','extra','reference'] loop address:=address||jsonb_build_object(k,private.txt(p_doc#>>array['address',k],k,false,200)); end loop;
 return jsonb_build_object('customer',private.txt(p_doc->>'customer','customer',false,100),'items',items,'payments',payments,'totals',jsonb_build_object('gas',gas,'water',water),'fee',fee,'benefitPrice',p_price,'cash',cash,'tendered',tendered,'change',tendered-cash,'changeFrom',change_from,'notes',private.txt(p_doc->>'notes','notes',false),'address',address,'delivery',d,'posted',private.flag(p_doc->'posted'));
end $$;

create function private.cash_summary(p_unit uuid,p_day uuid) returns jsonb language sql stable set search_path='' as $$
 with d as (select * from public.cash_days where unit_id=p_unit and id=p_day), totals as (
 select coalesce(sum(case when e.to_account='cash' then e.amount else 0 end-case when e.from_account='cash' then e.amount else 0 end),0)::bigint cash,
 coalesce(sum(case when e.to_account='fund' then e.amount else 0 end-case when e.from_account='fund' then e.amount else 0 end),0)::bigint fund,
 coalesce(sum(case when e.from_account='external' then e.amount else 0 end),0)::bigint income,
 coalesce(sum(case when e.to_account='external' then e.amount else 0 end),0)::bigint expense,
 coalesce(sum(case when e.kind in ('saleReceipt','saleChange') then case when e.from_account='external' then e.amount when e.to_account='external' then -e.amount else 0 end else 0 end),0)::bigint sales,
 coalesce(sum(case when e.from_account<>'external' and e.to_account<>'external' then e.amount else 0 end),0)::bigint transfers,
 coalesce(sum(case when e.kind='adjustment' then case when e.from_account='external' then e.amount else -e.amount end else 0 end),0)::bigint adjustments
 from public.financial_movements m join public.movement_entries e on e.unit_id=m.unit_id and e.movement_id=m.id where m.unit_id=p_unit and m.day_id=p_day)
 select jsonb_build_object('cash',d.initial_cash+t.cash,'fund',d.initial_fund+t.fund,'total',d.initial_cash+d.initial_fund+t.cash+t.fund,'income',t.income,'expense',t.expense,'sales',t.sales,'transfers',t.transfers,'adjustments',t.adjustments,'missing',greatest(0,d.reference_fund-d.initial_fund-t.fund),'excess',greatest(0,d.initial_fund+t.fund-d.reference_fund)) from d cross join totals t
$$;
create function private.assert_balances(p_unit uuid,p_day uuid) returns void language plpgsql set search_path='' as $$
declare s jsonb:=private.cash_summary(p_unit,p_day); begin
 if (s->>'cash')::bigint<0 or (s->>'fund')::bigint<0 then raise exception using errcode='P0001',message='LC_INSUFFICIENT_FUNDS'; end if;
 if (s->>'total')::bigint>999999999999 then raise exception using errcode='22023',message='LC_BALANCE_LIMIT'; end if;
end $$;
create function private.sale_due(p_unit uuid,p_sale uuid) returns jsonb language sql stable set search_path='' as $$
 select case when s.canceled then jsonb_build_object('gas',0,'water',0,'fee',0) else jsonb_build_object(
 'gas',coalesce((select sum(amount) from public.payment_allocations where unit_id=p_unit and sale_id=s.id and revision=s.current_revision and method='creditSale' and category='gas'),0)-coalesce((select sum(amount) from public.debt_receipts where unit_id=p_unit and sale_id=s.id and reversed_by is null and target='gas'),0),
 'water',coalesce((select sum(amount) from public.payment_allocations where unit_id=p_unit and sale_id=s.id and revision=s.current_revision and method='creditSale' and category='water'),0)-coalesce((select sum(amount) from public.debt_receipts where unit_id=p_unit and sale_id=s.id and reversed_by is null and target='water'),0),
 'fee',coalesce((select amount from public.delivery_fees where unit_id=p_unit and sale_id=s.id and revision=s.current_revision and initial_status='pending'),0)-coalesce((select sum(amount) from public.debt_receipts where unit_id=p_unit and sale_id=s.id and reversed_by is null and target='fee'),0)) end from public.sales s where s.unit_id=p_unit and s.id=p_sale
$$;
create function private.bump(p_value jsonb,p_path text[],p_amount bigint) returns jsonb language sql immutable set search_path='' as $$ select jsonb_set(p_value,p_path,to_jsonb(coalesce((p_value#>>p_path)::bigint,0)+p_amount),true) $$;
create function private.commercial_report(p_unit uuid,p_day uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare empty_methods jsonb:='{"cash":0,"pix":0,"debit":0,"credit":0,"benefit":0}'; category jsonb; cats jsonb; quantities jsonb:='{}'; payments jsonb;
 s record; i record; p record; f record; r record; k text; c text; due jsonb; pending bigint:=0; pending_today bigint:=0; benefit_qty bigint:=0;
 debt bigint:=0; previous_debt bigint:=0; expense bigint; sold bigint; received bigint:=0; credit_sold bigint; deliveries bigint; unposted bigint; legacy bigint;
begin
 category:=jsonb_build_object('products',0,'feeBilled',0,'sold',0,'creditSold',0,'payments',empty_methods,'fees',empty_methods,'debtPayments',empty_methods,'received',0);
 cats:=jsonb_build_object('gas',category,'water',category); payments:=empty_methods;
 foreach k in array array['p13','p08','p45','water20','pack510'] loop quantities:=quantities||jsonb_build_object(k,jsonb_build_object('sold',0,'delivered',0,'pending',0)); end loop;
 for s in select a.*,d.status delivery_status from public.sales a join public.deliveries d on d.unit_id=a.unit_id and d.sale_id=a.id where a.unit_id=p_unit and a.day_id=p_day and not a.canceled loop
  for i in select * from public.sale_items where unit_id=p_unit and sale_id=s.id and revision=s.current_revision loop
   c:=i.category::text; cats:=private.bump(cats,array[c,'products'],i.total); cats:=private.bump(cats,array[c,'sold'],i.total);
   quantities:=private.bump(quantities,array[i.product,'sold'],i.quantity);
   quantities:=private.bump(quantities,array[i.product,case when s.delivery_status in ('delivered','collected') then 'delivered' else 'pending' end],i.quantity);
   if i.benefit then benefit_qty:=benefit_qty+i.quantity; end if;
  end loop;
  for p in select * from public.payment_allocations where unit_id=p_unit and sale_id=s.id and revision=s.current_revision loop
   c:=p.category::text;
   if p.method='creditSale' then cats:=private.bump(cats,array[c,'creditSold'],p.amount); else cats:=private.bump(cats,array[c,'payments',p.method::text],p.amount); end if;
  end loop;
  for f in select * from public.delivery_fees where unit_id=p_unit and sale_id=s.id and revision=s.current_revision loop
   cats:=private.bump(cats,array['gas','sold'],f.amount); cats:=private.bump(cats,array['gas','feeBilled'],f.amount);
   if f.initial_status='paid' then cats:=private.bump(cats,array['gas','payments',f.method::text],f.amount); cats:=private.bump(cats,array['gas','fees',f.method::text],f.amount);
   else cats:=private.bump(cats,array['gas','creditSold'],f.amount); end if;
  end loop;
 end loop;
 for r in select * from public.debt_receipts where unit_id=p_unit and day_id=p_day and reversed_by is null loop
  c:=r.category::text; cats:=private.bump(cats,array[c,'payments',r.method::text],r.amount); cats:=private.bump(cats,array[c,'debtPayments',r.method::text],r.amount);
  if r.target='fee' then cats:=private.bump(cats,array['gas','fees',r.method::text],r.amount); end if;
  debt:=debt+r.amount;
  if r.sale_id is null or exists(select 1 from public.sales where unit_id=p_unit and id=r.sale_id and day_id<>p_day) then previous_debt:=previous_debt+r.amount; end if;
 end loop;
 foreach c in array array['gas','water'] loop
  foreach k in array array['cash','pix','debit','credit','benefit'] loop
   payments:=private.bump(payments,array[k],(cats#>>array[c,'payments',k])::bigint);
   cats:=private.bump(cats,array[c,'received'],(cats#>>array[c,'payments',k])::bigint);
  end loop;
  received:=received+(cats#>>array[c,'received'])::bigint;
 end loop;
 for s in select * from public.sales where unit_id=p_unit and not canceled loop
  due:=private.sale_due(p_unit,s.id);
  pending:=pending+(due->>'gas')::bigint+(due->>'water')::bigint+(due->>'fee')::bigint;
  if s.day_id=p_day then pending_today:=pending_today+(due->>'gas')::bigint+(due->>'water')::bigint+(due->>'fee')::bigint; end if;
 end loop;
 select coalesce(sum(e.amount),0) into expense from public.financial_movements m join public.movement_entries e on e.unit_id=m.unit_id and e.movement_id=m.id where m.unit_id=p_unit and m.day_id=p_day and m.type='expense' and not exists(select 1 from public.financial_movements x where x.unit_id=p_unit and x.reverses=m.id);
 select coalesce(sum(legacy_sale_amount),0) into legacy from public.financial_movements m where m.unit_id=p_unit and m.day_id=p_day and m.type='sale' and not exists(select 1 from public.financial_movements x where x.unit_id=p_unit and x.reverses=m.id);
 select count(*) filter(where coalesce(d.status not in ('delivered','collected'),true)),count(*) filter(where not sale_row.posted) into deliveries,unposted from public.sales sale_row join public.deliveries d on d.unit_id=sale_row.unit_id and d.sale_id=sale_row.id where sale_row.unit_id=p_unit and sale_row.day_id=p_day and not sale_row.canceled;
 sold:=(cats#>>'{gas,sold}')::bigint+(cats#>>'{water,sold}')::bigint; credit_sold:=(cats#>>'{gas,creditSold}')::bigint+(cats#>>'{water,creditSold}')::bigint;
 return jsonb_build_object('categories',cats,'payments',payments,'quantities',quantities,'benefitQuantity',benefit_qty,'sales',sold,'received',received,'creditSold',credit_sold,'pending',pending,'pendingToday',pending_today,'debtReceived',debt,'previousDebtReceived',previous_debt,'expense',expense,'legacySales',legacy,'deliveries',deliveries,'unposted',unposted,'deliveryQueue',(select count(*) from public.sales sale_row join public.deliveries d on d.unit_id=sale_row.unit_id and d.sale_id=sale_row.id where sale_row.unit_id=p_unit and not sale_row.canceled and coalesce(d.status not in ('delivered','collected'),true)),'revGasQueue',(select count(*) from public.sales where unit_id=p_unit and not canceled and not posted),'physical',private.cash_summary(p_unit,p_day));
end $$;

-- Barreiras adicionais: históricos físicos e versões financeiras são append-only.
create function private.immutable_row() returns trigger language plpgsql security definer set search_path='' as $$ begin raise exception using errcode='42501',message='LC_IMMUTABLE_HISTORY'; end $$;
create function private.guard_financial_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare day uuid; st text; begin
 if tg_table_name='financial_movements' then day:=new.day_id;
 elsif tg_table_name='movement_entries' then select day_id into day from public.financial_movements where unit_id=new.unit_id and id=new.movement_id;
 else select day_id into day from public.sales where unit_id=new.unit_id and id=new.sale_id; end if;
 select status into st from public.cash_days where unit_id=new.unit_id and id=day;
 if st is distinct from 'open' then raise exception using errcode='P0001',message='LC_CASH_NOT_OPEN'; end if;
 return new; end $$;
do $$ declare t text; begin
 foreach t in array array['financial_movements','movement_entries','sale_versions','sale_items','payment_allocations','delivery_fees'] loop
  execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.immutable_row()',t);
  execute format('create trigger require_open_cash before insert on public.%I for each row execute function private.guard_financial_insert()',t);
 end loop;
 foreach t in array array['audit_events','sync_operations','unit_changes','cash_closings'] loop
  execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.immutable_row()',t);
 end loop;
end $$;
create function private.guard_cash_day() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if old.status='closed' or new.unit_id<>old.unit_id or new.id<>old.id or new.business_date<>old.business_date or new.initial_cash<>old.initial_cash or new.initial_fund<>old.initial_fund or new.reference_fund<>old.reference_fund then raise exception using errcode='42501',message='LC_IMMUTABLE_CASH'; end if;
 if new.status<>old.status and not ((old.status='open' and new.status='closing') or (old.status='closing' and new.status in ('open','closed'))) then raise exception using errcode='P0001',message='LC_INVALID_CLOSE_TRANSITION'; end if;
 return new; end $$;
create trigger guard_cash_day before update on public.cash_days for each row execute function private.guard_cash_day();
create trigger no_delete_cash before delete on public.cash_days for each row execute function private.immutable_row();
commit;
