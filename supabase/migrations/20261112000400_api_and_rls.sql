begin;
revoke create on schema public from public,anon,authenticated;
create function private.command_permission(p_type text) returns text language sql immutable set search_path='' as $$ select case
 when p_type in ('open_day','movement','movement_reverse','small_notes') then 'cash_write'
 when p_type in ('sale_create','sale_correct','sale_cancel','draft_save','draft_cancel') then 'sale_write'
 when p_type='sale_update' then 'delivery_write'
 when p_type in ('receipt_create','receipt_reverse') then 'receipt_write'
 when p_type='benefit_price' then 'settings_write'
 when p_type='close_ack' then 'cash_write'
 when p_type in ('close_prepare','close_commit','close_abort') then 'close' end $$;
create function private.change(p_unit uuid,p_op uuid,p_type text,p_refs jsonb) returns bigint language plpgsql set search_path='' as $$
declare v bigint; begin
 update public.operating_units set change_version=change_version+1 where id=p_unit returning change_version into v;
 insert into public.unit_changes(unit_id,version,operation_id,change_type,entity_refs) values(p_unit,v,p_op,p_type,p_refs);
 return v; end $$;
create function private.device(p_unit uuid,p_device uuid) returns public.devices language plpgsql set search_path='' as $$
declare d public.devices; begin
 select * into d from public.devices where unit_id=p_unit and id=p_device and user_id=auth.uid() and active for update;
 if not found then raise exception using errcode='42501',message='LC_DEVICE_NOT_AUTHORIZED'; end if;
 return d; end $$;

create function public.lc_register_device(p_unit uuid,p_device uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; begin
 perform private.require_permission(p_unit,'cash_write');
 perform 1 from public.operating_units where id=p_unit for update;
 select * into d from public.devices where id=p_device;
 if found then
  if d.unit_id<>p_unit or d.user_id<>auth.uid() or not d.active then raise exception using errcode='42501',message='LC_DEVICE_NOT_AUTHORIZED'; end if;
  return to_jsonb(d);
 end if;
 if exists(select 1 from public.cash_days where unit_id=p_unit and status='closing') then raise exception using errcode='P0001',message='LC_CLOSE_IN_PROGRESS'; end if;
 insert into public.devices(id,unit_id,user_id,name) values(p_device,p_unit,auth.uid(),private.txt(p_name,'device',true,100)) returning * into d;
 perform private.audit(p_unit,p_device,null,'device',p_device::text,'device_registered','Dispositivo registrado',null,to_jsonb(d));
 perform private.change(p_unit,null,'device_registered',jsonb_build_object('deviceId',p_device));
 return to_jsonb(d);
end $$;

create function public.lc_publish_queue(p_unit uuid,p_device uuid,p_generation bigint,p_operations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; row public.device_pending_operations; op public.sync_operations; x jsonb; command jsonb; op_id uuid; hash text; v_manifest_hash text; typ text; day uuid; v bigint;
begin
 perform private.require_permission(p_unit,'cash_write');
 perform 1 from public.operating_units where id=p_unit for update;
 d:=private.device(p_unit,p_device);
 if p_generation is null or p_generation<1 or jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations)>1000 then raise exception using errcode='22023',message='LC_INVALID_MANIFEST'; end if;
 v_manifest_hash:=private.hash(p_operations);
 if p_generation=d.manifest_generation and v_manifest_hash=d.manifest_hash then return jsonb_build_object('generation',p_generation,'accepted',true); end if;
 if p_generation<=d.manifest_generation then raise exception using errcode='P0001',message='LC_MANIFEST_GENERATION_CONFLICT'; end if;
 if exists(select 1 from public.device_pending_operations q where q.unit_id=p_unit and q.device_id=p_device and q.status='pending' and not exists(select 1 from jsonb_array_elements(p_operations) a where (a->>'id')::uuid=q.id)) then raise exception using errcode='P0001',message='LC_CANNOT_OMIT_PENDING_OPERATION'; end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_operations)) then raise exception using errcode='22023',message='LC_DUPLICATE_MANIFEST_ID'; end if;
 for x in select value from jsonb_array_elements(p_operations) loop
  op_id:=private.id(x,'id'); command:=x->'command'; typ:=command->>'type'; day:=(command->>'dayId')::uuid;
  if jsonb_typeof(command) is distinct from 'object' or private.command_permission(typ) is null or typ like 'close_%' then raise exception using errcode='22023',message='LC_INVALID_QUEUED_COMMAND'; end if;
  perform private.require_permission(p_unit,private.command_permission(typ));
  if typ not in ('benefit_price','draft_save','draft_cancel') and day is null then raise exception using errcode='22023',message='LC_DAY_REQUIRED'; end if;
  if day is not null and exists(select 1 from public.cash_days where id=day and unit_id<>p_unit) then raise exception using errcode='42501',message='LC_FOREIGN_DAY'; end if;
  hash:=private.hash(command);
  select * into row from public.device_pending_operations where unit_id=p_unit and id=op_id;
  if found then
   if row.device_id<>p_device or row.request_hash<>hash then raise exception using errcode='P0001',message='LC_OPERATION_PAYLOAD_CONFLICT'; end if;
   if row.status='discarded' then raise exception using errcode='P0001',message='LC_OPERATION_DISCARDED'; end if;
  else
   select * into op from public.sync_operations where unit_id=p_unit and id=op_id;
   if found and (op.device_id<>p_device or op.request_hash<>hash or op.actor_id<>auth.uid()) then raise exception using errcode='P0001',message='LC_OPERATION_PAYLOAD_CONFLICT'; end if;
   insert into public.device_pending_operations(unit_id,id,device_id,day_id,command_type,request_hash,command_data,status,resolved_at) values(p_unit,op_id,p_device,day,typ,hash,command,case when op.id is null then 'pending' else 'applied' end,case when op.id is not null then now() end);
  end if;
 end loop;
 update public.devices set manifest_generation=p_generation,manifest_hash=v_manifest_hash,last_seen_at=now() where id=p_device;
 perform private.audit(p_unit,p_device,null,'device',p_device::text,'queue_manifest','Manifesto de operações locais',jsonb_build_object('generation',d.manifest_generation),jsonb_build_object('generation',p_generation,'hash',v_manifest_hash));
 v:=private.change(p_unit,null,'queue_manifest',jsonb_build_object('deviceId',p_device,'generation',p_generation));
 return jsonb_build_object('generation',p_generation,'accepted',true);
end $$;

create function public.lc_apply_operation(p_unit uuid,p_device uuid,p_operation uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; existing public.sync_operations; pending public.device_pending_operations;
 typ text:=p_command->>'type'; permission text; hash text; result jsonb; response jsonb; v bigint;
begin
 permission:=private.command_permission(typ);
 if permission is null or p_operation is null or jsonb_typeof(p_command) is distinct from 'object' or jsonb_typeof(p_command->'data') is distinct from 'object' then raise exception using errcode='22023',message='LC_INVALID_COMMAND'; end if;
 perform private.require_permission(p_unit,permission);
 -- A ordem de lock é sempre unidade -> dispositivo -> entidades financeiras.
 perform 1 from public.operating_units where id=p_unit for update;
 d:=private.device(p_unit,p_device); hash:=private.hash(p_command);
 select * into existing from public.sync_operations where unit_id=p_unit and id=p_operation;
 if found then
  if existing.device_id<>p_device or existing.actor_id<>auth.uid() or existing.request_hash<>hash then raise exception using errcode='P0001',message='LC_OPERATION_PAYLOAD_CONFLICT'; end if;
  return existing.response_data;
 end if;
 if typ not like 'close_%' then
  select * into pending from public.device_pending_operations where unit_id=p_unit and id=p_operation;
  if not found or pending.device_id<>p_device or pending.request_hash<>hash or pending.status<>'pending' then raise exception using errcode='P0001',message='LC_MANIFEST_OPERATION_REQUIRED'; end if;
 end if;
 result:=private.dispatch(p_unit,p_device,p_operation,p_command);
 v:=private.change(p_unit,p_operation,typ,result||jsonb_build_object('dayId',p_command->'dayId'));
 response:=jsonb_build_object('operationId',p_operation,'unitId',p_unit,'serverVersion',v,'result',result);
 insert into public.sync_operations(unit_id,id,device_id,actor_id,command_type,request_hash,request_data,response_data,server_version) values(p_unit,p_operation,p_device,auth.uid(),typ,hash,p_command,response,v);
 update public.device_pending_operations set status='applied',resolved_at=now() where unit_id=p_unit and id=p_operation;
 update public.devices set last_seen_at=now() where id=p_device;
 return response;
end $$;

create function public.lc_discard_pending(p_unit uuid,p_device uuid,p_operation uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.device_pending_operations; begin
 perform private.require_permission(p_unit,'members_manage'); perform 1 from public.operating_units where id=p_unit for update;
 p_reason:=private.txt(p_reason,'reason');
 select * into q from public.device_pending_operations where unit_id=p_unit and device_id=p_device and id=p_operation for update;
 if not found or q.status='applied' then raise exception using errcode='P0001',message='LC_CANNOT_DISCARD'; end if;
 if q.status='discarded' then
  if q.discard_reason<>p_reason then raise exception using errcode='P0001',message='LC_DISCARD_CONFLICT'; end if;
  return jsonb_build_object('discarded',true);
 end if;
 update public.device_pending_operations set status='discarded',discard_reason=p_reason,resolved_at=now() where unit_id=p_unit and id=p_operation;
 update public.devices set manifest_generation=manifest_generation+1,manifest_hash=null where unit_id=p_unit and id=p_device;
 perform private.audit(p_unit,p_device,null,'pending_operation',p_operation::text,'queue_discarded',p_reason,to_jsonb(q),jsonb_build_object('status','discarded'));
 perform private.change(p_unit,null,'queue_discarded',jsonb_build_object('deviceId',p_device,'operationId',p_operation));
 return jsonb_build_object('discarded',true);
end $$;

create function public.lc_changes(p_unit uuid,p_after bigint default 0,p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb; cursor bigint; begin
 perform private.require_permission(p_unit,'read');
 if p_after is null or p_after<0 or p_limit is null or p_limit not between 1 and 500 then raise exception using errcode='22023',message='LC_INVALID_CURSOR'; end if;
 select coalesce(jsonb_agg(to_jsonb(c) order by version),'[]'),coalesce(max(version),p_after) into data,cursor from (select * from public.unit_changes where unit_id=p_unit and version>p_after order by version limit p_limit) c;
 return jsonb_build_object('changes',data,'cursor',cursor,'hasMore',exists(select 1 from public.unit_changes where unit_id=p_unit and version>cursor));
end $$;
create function public.lc_day_report(p_unit uuid,p_day uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 perform private.require_permission(p_unit,'read');
 if not exists(select 1 from public.cash_days where unit_id=p_unit and id=p_day) then raise exception using errcode='P0001',message='LC_CASH_NOT_FOUND'; end if;
 return private.commercial_report(p_unit,p_day); end $$;

-- Bootstrap privilegiado: nunca concedido à API, nem acionado por signup.
create function private.bootstrap_admin(p_user uuid,p_unit uuid,p_email text,p_display_name text,p_unit_name text) returns uuid
language plpgsql set search_path='' as $$
declare actual_email text; confirmed timestamptz; begin
 perform pg_advisory_xact_lock(hashtextextended('liquigas-initial-bootstrap',0));
 if exists(select 1 from public.unit_memberships where role='admin') then raise exception using errcode='P0001',message='LC_ALREADY_BOOTSTRAPPED'; end if;
 select email,email_confirmed_at into actual_email,confirmed from auth.users where id=p_user and not coalesce(is_anonymous,false);
 if actual_email is null or confirmed is null or lower(actual_email)<>lower(p_email) then raise exception using errcode='22023',message='LC_CONFIRMED_AUTH_USER_REQUIRED'; end if;
 insert into public.profiles(id,display_name) values(p_user,private.txt(p_display_name,'display name',true,100));
 insert into public.operating_units(id,name) values(p_unit,private.txt(p_unit_name,'unit name',true,100));
 insert into public.unit_memberships(unit_id,user_id,role) values(p_unit,p_user,'admin');
 insert into public.unit_settings(unit_id) values(p_unit);
 insert into public.audit_events(unit_id,actor_id,entity_type,entity_id,event_type,reason,after_data) values(p_unit,p_user,'membership',p_user::text,'initial_admin','Bootstrap privilegiado da primeira administradora',jsonb_build_object('role','admin'));
 return p_unit;
end $$;

-- RLS, ACL e ausência de escrita direta são parte da fronteira de segurança.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_permission(uuid,text) to authenticated;
do $$ declare t text; begin
 foreach t in array array['operating_units','unit_memberships','unit_settings','devices','cash_days','sales','sale_drafts','delivery_assignees','deliveries','financial_movements','movement_entries','sale_versions','sale_items','payment_allocations','delivery_fees','debt_receipts','audit_events','sync_operations','device_pending_operations','unit_changes','close_acknowledgments','cash_closings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
  execute format('grant select on table public.%I to authenticated',t);
  if t='operating_units' then
   execute format('create policy unit_read on public.%I for select to authenticated using (private.has_permission(id,''read''))',t);
  else
   execute format('create policy unit_read on public.%I for select to authenticated using (private.has_permission(unit_id,''read''))',t);
  end if;
 end loop;
end $$;
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false) and exists(select 1 from public.unit_memberships where user_id=auth.uid() and active));
revoke all on function public.lc_register_device(uuid,uuid,text),public.lc_publish_queue(uuid,uuid,bigint,jsonb),public.lc_apply_operation(uuid,uuid,uuid,jsonb),public.lc_discard_pending(uuid,uuid,uuid,text),public.lc_changes(uuid,bigint,integer),public.lc_day_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lc_register_device(uuid,uuid,text),public.lc_publish_queue(uuid,uuid,bigint,jsonb),public.lc_apply_operation(uuid,uuid,uuid,jsonb),public.lc_discard_pending(uuid,uuid,uuid,text),public.lc_changes(uuid,bigint,integer),public.lc_day_report(uuid,uuid) to authenticated;
commit;
