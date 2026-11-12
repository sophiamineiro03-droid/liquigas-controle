begin;
create function private.guard_sale_projection() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.id<>old.id or new.unit_id<>old.unit_id or new.day_id<>old.day_id or new.created_by<>old.created_by or new.created_at<>old.created_at or new.client_created_at is distinct from old.client_created_at or old.canceled then raise exception using errcode='42501',message='LC_IMMUTABLE_SALE_IDENTITY'; end if;
 if new.entity_version<>old.entity_version+1 or new.current_revision not in (old.current_revision,old.current_revision+1) then raise exception using errcode='23514',message='LC_INVALID_SALE_VERSION'; end if;
 if new.current_revision<>old.current_revision or new.canceled<>old.canceled then
  perform private.open_day(old.unit_id,old.day_id);
 end if;
 return new; end $$;
create trigger protect_sale_projection before update on public.sales for each row execute function private.guard_sale_projection();
create trigger no_delete_sale before delete on public.sales for each row execute function private.immutable_row();
create trigger no_delete_receipt before delete on public.debt_receipts for each row execute function private.immutable_row();
create trigger no_delete_draft before delete on public.sale_drafts for each row execute function private.immutable_row();
create function private.guard_receipt_projection() returns trigger language plpgsql security definer set search_path='' as $$ begin
 perform private.open_day(new.unit_id,new.day_id);
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['reversed_by','reversed_at','entity_version']) is distinct from (to_jsonb(old)-array['reversed_by','reversed_at','entity_version']) or old.reversed_by is not null or new.reversed_by is null or new.entity_version<>old.entity_version+1 then raise exception using errcode='42501',message='LC_IMMUTABLE_RECEIPT'; end if;
 end if;
 return new; end $$;
create trigger protect_receipt before insert or update on public.debt_receipts for each row execute function private.guard_receipt_projection();
create function private.entry_document(p_unit uuid,p_movement uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('from',from_account,'to',to_account,'amount',amount,'kind',kind) order by line_no),'[]') from public.movement_entries where unit_id=p_unit and movement_id=p_movement
$$;
create function private.check_sale_cash_posting() returns trigger language plpgsql security definer set search_path='' as $$
declare expected jsonb:='[]'; m public.financial_movements; begin
 select * into m from public.financial_movements where unit_id=new.unit_id and id=new.movement_id;
 if m.type is distinct from 'operationalSale' or m.sale_id is distinct from new.sale_id then raise exception using errcode='23514',message='LC_SALE_MOVEMENT_MISMATCH'; end if;
 if new.tendered>0 then expected:=expected||jsonb_build_array(jsonb_build_object('from','external','to','cash','amount',new.tendered,'kind','saleReceipt')); end if;
 if new.change_amount>0 then expected:=expected||jsonb_build_array(jsonb_build_object('from',new.change_from,'to','external','amount',new.change_amount,'kind','saleChange')); end if;
 if private.entry_document(new.unit_id,new.movement_id)<>expected then raise exception using errcode='23514',message='LC_SALE_POSTING_MISMATCH'; end if;
 return null; end $$;
create constraint trigger sale_posting after insert on public.sale_versions deferrable initially deferred for each row execute function private.check_sale_cash_posting();
create function private.check_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.debt_receipts; m public.financial_movements; expected jsonb:='[]'; due jsonb; begin
 select * into r from public.debt_receipts where id=new.id;
 select * into m from public.financial_movements where unit_id=r.unit_id and id=r.movement_id;
 if m.type is distinct from 'debtReceipt' or m.receipt_id is distinct from r.id or m.day_id is distinct from r.day_id then raise exception using errcode='23514',message='LC_RECEIPT_MOVEMENT_MISMATCH'; end if;
 if r.method='cash' then expected:=jsonb_build_array(jsonb_build_object('from','external','to','cash','amount',r.amount,'kind','debtReceipt')); end if;
 if private.entry_document(r.unit_id,r.movement_id)<>expected then raise exception using errcode='23514',message='LC_RECEIPT_POSTING_MISMATCH'; end if;
 if r.sale_id is not null and r.reversed_by is null then
  due:=private.sale_due(r.unit_id,r.sale_id);
  if (due->>'gas')::bigint<0 or (due->>'water')::bigint<0 or (due->>'fee')::bigint<0 then raise exception using errcode='23514',message='LC_OVERPAYMENT'; end if;
 end if;
 if r.reversed_by is not null and not exists(select 1 from public.financial_movements where unit_id=r.unit_id and id=r.reversed_by and day_id=r.day_id and reverses=r.movement_id) then raise exception using errcode='23514',message='LC_RECEIPT_REVERSAL_MISMATCH'; end if;
 return null; end $$;
create constraint trigger receipt_consistency after insert or update on public.debt_receipts deferrable initially deferred for each row execute function private.check_receipt();
create function private.check_movement() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.financial_movements; original public.financial_movements; expected jsonb; entry public.movement_entries; entry_count integer; begin
 if tg_table_name='movement_entries' then select * into m from public.financial_movements where unit_id=new.unit_id and id=new.movement_id;
 else m:=new; end if;
 -- API já segura o lock; esta barreira também cobre inserções SQL privilegiadas.
 perform 1 from public.operating_units where id=m.unit_id for update;
 perform private.assert_balances(m.unit_id,m.day_id);
 if m.type='reversal' then
  select * into original from public.financial_movements where unit_id=m.unit_id and id=m.reverses;
  if original.type='reversal' or original.day_id<>m.day_id then raise exception using errcode='23514',message='LC_INVALID_REVERSAL_TARGET'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('from',to_account,'to',from_account,'amount',amount,'kind',kind) order by line_no),'[]') into expected from public.movement_entries where unit_id=m.unit_id and movement_id=m.reverses;
  if private.entry_document(m.unit_id,m.id)<>expected then raise exception using errcode='23514',message='LC_REVERSAL_POSTING_MISMATCH'; end if;
 elsif m.type in ('income','expense','adjustment','transfer','replenish') then
  select count(*) into entry_count from public.movement_entries where unit_id=m.unit_id and movement_id=m.id;
  select * into entry from public.movement_entries where unit_id=m.unit_id and movement_id=m.id limit 1;
  if entry_count<>1 or (m.type='income' and not (entry.kind='income' and entry.from_account='external' and entry.to_account in ('cash','fund')))
   or (m.type='expense' and not (entry.kind='expense' and entry.to_account='external' and entry.from_account in ('cash','fund')))
   or (m.type='adjustment' and not (entry.kind='adjustment' and ((entry.from_account='external' and entry.to_account in ('cash','fund')) or (entry.to_account='external' and entry.from_account in ('cash','fund')))))
   or (m.type in ('transfer','replenish') and not (entry.kind='transfer' and entry.from_account in ('cash','fund') and entry.to_account in ('cash','fund')))
   or (m.type='replenish' and not (entry.from_account='cash' and entry.to_account='fund')) then raise exception using errcode='23514',message='LC_MOVEMENT_POSTING_MISMATCH'; end if;
 elsif m.type='sale' then
  expected:=jsonb_build_array(jsonb_build_object('from','external','to','cash','amount',m.legacy_received,'kind','saleReceipt'));
  if m.legacy_received>m.legacy_sale_amount then expected:=expected||jsonb_build_array(jsonb_build_object('from','fund','to','external','amount',m.legacy_received::bigint-m.legacy_sale_amount::bigint,'kind','saleChange')); end if;
  if private.entry_document(m.unit_id,m.id)<>expected then raise exception using errcode='23514',message='LC_LEGACY_POSTING_MISMATCH'; end if;
 end if;
 return null; end $$;
create constraint trigger movement_balances after insert on public.financial_movements deferrable initially deferred for each row execute function private.check_movement();
create constraint trigger movement_entry_balances after insert on public.movement_entries deferrable initially deferred for each row execute function private.check_movement();
create function private.guard_closing_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.cash_days; expected jsonb; begin
 select * into d from public.cash_days where unit_id=new.unit_id and id=new.day_id;
 -- É executado antes da mudança de estado para closed na mesma transação.
 if d.status is distinct from 'closing' or d.close_round_id is distinct from new.round_id or d.financial_version<>new.financial_version then raise exception using errcode='23514',message='LC_INVALID_CLOSING_STATE'; end if;
 expected:=private.cash_summary(new.unit_id,new.day_id);
 if new.expected_cash<>(expected->>'cash')::bigint or new.expected_fund<>(expected->>'fund')::bigint or new.expected<>expected then raise exception using errcode='23514',message='LC_INVALID_CLOSING_EXPECTED'; end if;
 return new; end $$;
create trigger closing_expected before insert on public.cash_closings for each row execute function private.guard_closing_insert();
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_permission(uuid,text) to authenticated;
commit;
