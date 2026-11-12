-- Sem dados de produção, credenciais ou vínculo com projeto remoto.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create domain private.cents as bigint check (value between 0 and 999999999999);
create domain private.positive_cents as bigint check (value between 1 and 999999999999);
create type private.category as enum ('gas', 'water');
create type private.payment_method as enum ('cash','pix','debit','credit','creditSale','benefit');
create type private.cash_account as enum ('cash','fund','external');

create table public.operating_units (
 id uuid primary key, name text not null check(length(btrim(name)) between 1 and 100),
 timezone text not null default 'America/Sao_Paulo' check(timezone='America/Sao_Paulo'),
 change_version bigint not null default 0 check(change_version>=0), created_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 display_name text not null check(length(btrim(display_name)) between 1 and 100), created_at timestamptz not null default now()
);
create table public.unit_memberships (
 unit_id uuid not null references public.operating_units(id), user_id uuid not null references public.profiles(id),
 role text not null check(role in ('admin','operator','viewer')), active boolean not null default true,
 created_at timestamptz not null default now(), primary key(unit_id,user_id)
);
create table private.role_permissions (role text not null, permission text not null, primary key(role,permission));
insert into private.role_permissions
select 'admin',unnest(array['read','cash_write','sale_write','receipt_write','delivery_write','settings_write','close','members_manage']);
insert into private.role_permissions
select 'operator',unnest(array['read','cash_write','sale_write','receipt_write','delivery_write']);
insert into private.role_permissions values ('viewer','read');
create table public.unit_settings (
 unit_id uuid primary key references public.operating_units(id), benefit_price private.positive_cents not null default 10798,
 entity_version bigint not null default 1 check(entity_version>0)
);
create table public.devices (
 id uuid primary key, unit_id uuid not null references public.operating_units(id),
 user_id uuid not null references public.profiles(id), name text not null check(length(btrim(name)) between 1 and 100),
 active boolean not null default true, manifest_generation bigint not null default 0 check(manifest_generation>=0),
 manifest_hash text, last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(unit_id,id)
);
create table public.cash_days (
 id uuid primary key, unit_id uuid not null references public.operating_units(id), business_date date not null,
 initial_cash private.cents not null, initial_fund private.cents not null, reference_fund private.cents not null default 10000 check(reference_fund=10000),
 notes text not null default '' check(length(notes)<=500), opened_by uuid not null references public.profiles(id),
 legacy_user_label text, client_created_at timestamptz, created_at timestamptz not null default now(),
 status text not null default 'open' check(status in ('open','closing','closed')),
 financial_version bigint not null default 0 check(financial_version>=0),
 small_notes_needed boolean not null default false, close_round_id uuid, close_base_version bigint,
 unique(unit_id,id), unique(unit_id,business_date), check(initial_cash::bigint+initial_fund::bigint<=999999999999),
 check((status='closing')=(close_round_id is not null and close_base_version is not null))
);
create unique index one_active_cash_per_unit on public.cash_days(unit_id) where status in ('open','closing');
create table public.sales (
 id uuid primary key, unit_id uuid not null, day_id uuid not null,
 current_revision integer not null default 1 check(current_revision>0), entity_version bigint not null default 1 check(entity_version>0),
 legacy_user_label text, customer text not null default '' check(length(customer)<=100), address jsonb not null default '{}' check(jsonb_typeof(address)='object'),
 notes text not null default '' check(length(notes)<=500), posted boolean not null default false,
 canceled boolean not null default false, canceled_at timestamptz,
 created_by uuid not null references public.profiles(id), client_created_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(unit_id,id),
 foreign key(unit_id,day_id) references public.cash_days(unit_id,id), check(canceled=(canceled_at is not null))
);
-- Cadastro de entregadores é opcional; o texto original continua preservado.
create table public.sale_drafts (
 id uuid primary key, unit_id uuid not null references public.operating_units(id), origin_day_id uuid,
 document jsonb not null default '{}' check(jsonb_typeof(document)='object' and octet_length(document::text)<=65536),
 entity_version bigint not null default 1 check(entity_version>0),
 status text not null default 'draft' check(status in ('draft','converted','canceled')),
 converted_sale_id uuid, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(unit_id,id), foreign key(unit_id,origin_day_id) references public.cash_days(unit_id,id),
 foreign key(unit_id,converted_sale_id) references public.sales(unit_id,id),
 check((status='converted')=(converted_sale_id is not null)), check(converted_sale_id is null or converted_sale_id=id)
);
create table public.delivery_assignees (
 id uuid primary key, unit_id uuid not null references public.operating_units(id), name text not null check(length(btrim(name)) between 1 and 100),
 kind text not null check(kind in ('person','depot')), active boolean not null default true, unique(unit_id,id)
);
create table public.deliveries (
 id uuid primary key, unit_id uuid not null, sale_id uuid not null,
 assignee_id uuid, driver text check(driver in ('Wagner','Vinicius','Depósito','Outro')),
 driver_other text not null default '' check(length(driver_other)<=100),
 status text check(status in ('awaiting','out','delivered','pickup','collected','canceled')),
 entity_version bigint not null default 1, updated_at timestamptz not null default now(), unique(unit_id,sale_id), unique(unit_id,id),
 foreign key(unit_id,sale_id) references public.sales(unit_id,id),
 foreign key(unit_id,assignee_id) references public.delivery_assignees(unit_id,id)
);
create table public.financial_movements (
 id uuid primary key, unit_id uuid not null, day_id uuid not null,
 type text not null check(type in ('income','expense','sale','transfer','replenish','adjustment','reversal','operationalSale','debtReceipt')),
 description text not null check(length(btrim(description)) between 1 and 500), notes text not null default '' check(length(notes)<=500),
 actor_id uuid not null references public.profiles(id), legacy_user_label text,
 sale_id uuid, receipt_id uuid, reverses uuid,
 legacy_sale_amount private.positive_cents, legacy_received private.positive_cents,
 client_created_at timestamptz, created_at timestamptz not null default now(), unique(unit_id,id),
 foreign key(unit_id,day_id) references public.cash_days(unit_id,id),
 foreign key(unit_id,sale_id) references public.sales(unit_id,id),
 foreign key(unit_id,reverses) references public.financial_movements(unit_id,id),
 check(not (sale_id is not null and receipt_id is not null)),
 check((type='operationalSale')=(sale_id is not null)), check((type='debtReceipt')=(receipt_id is not null)), check((type='reversal')=(reverses is not null)), check(id is distinct from reverses),
 check((type='sale')=(legacy_sale_amount is not null and legacy_received is not null)),
 check(legacy_received is null or legacy_received>=legacy_sale_amount)
);
create unique index one_reversal_per_movement on public.financial_movements(unit_id,reverses) where reverses is not null;
create table public.movement_entries (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null, movement_id uuid not null,
 line_no integer not null check(line_no>0), from_account private.cash_account not null, to_account private.cash_account not null,
 amount private.positive_cents not null, kind text not null check(kind in ('income','expense','saleReceipt','saleChange','transfer','adjustment','debtReceipt')),
 unique(unit_id,movement_id,line_no), foreign key(unit_id,movement_id) references public.financial_movements(unit_id,id), check(from_account<>to_account)
);
create table public.sale_versions (
 unit_id uuid not null, sale_id uuid not null, revision integer not null check(revision>0), movement_id uuid not null,
 benefit_price private.positive_cents not null, cash_amount private.cents not null, tendered private.cents not null,
 change_amount private.cents not null, change_from private.cash_account not null check(change_from in ('cash','fund')),
 legacy_user_label text, client_created_at timestamptz, original_document jsonb not null check(jsonb_typeof(original_document)='object'), reason text not null check(length(btrim(reason)) between 1 and 500),
 actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 primary key(unit_id,sale_id,revision), unique(unit_id,movement_id), foreign key(unit_id,sale_id) references public.sales(unit_id,id),
 foreign key(unit_id,movement_id) references public.financial_movements(unit_id,id), check(tendered::bigint=cash_amount::bigint+change_amount::bigint)
);
alter table public.sales add constraint current_sale_version foreign key(unit_id,id,current_revision)
 references public.sale_versions(unit_id,sale_id,revision) deferrable initially deferred;
create table public.sale_items (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null, sale_id uuid not null, revision integer not null,
 line_no integer not null check(line_no between 1 and 30), product text not null check(product in ('p13','p08','p45','water20','pack510')),
 category private.category not null, quantity integer not null check(quantity between 1 and 99999), total private.positive_cents not null,
 benefit boolean not null default false, unique(unit_id,sale_id,revision,line_no),
 foreign key(unit_id,sale_id,revision) references public.sale_versions(unit_id,sale_id,revision),
 check((product in ('p13','p08','p45') and category='gas') or (product in ('water20','pack510') and category='water')),
 check(not benefit or product='p13')
);
create table public.payment_allocations (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null, sale_id uuid not null, revision integer not null,
 line_no integer not null check(line_no between 1 and 30), category private.category not null, method private.payment_method not null,
 amount private.positive_cents not null, unique(unit_id,sale_id,revision,line_no),
 foreign key(unit_id,sale_id,revision) references public.sale_versions(unit_id,sale_id,revision), check(method<>'benefit' or category='gas')
);
create table public.delivery_fees (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null, sale_id uuid not null, revision integer not null,
 amount private.positive_cents not null, method private.payment_method not null check(method<>'benefit'),
 initial_status text not null check(initial_status in ('paid','pending')), unique(unit_id,sale_id,revision),
 foreign key(unit_id,sale_id,revision) references public.sale_versions(unit_id,sale_id,revision),
 check(method<>'creditSale' or initial_status='pending')
);
create table public.debt_receipts (
 id uuid primary key, unit_id uuid not null, day_id uuid not null, sale_id uuid, sale_revision integer,
 target text check(target in ('gas','water','fee')), category private.category not null,
 legacy_user_label text, customer text not null default '' check(length(customer)<=100), amount private.positive_cents not null,
 method private.payment_method not null check(method not in ('creditSale','benefit')), notes text not null default '' check(length(notes)<=500),
 movement_id uuid not null, reversed_by uuid, actor_id uuid not null references public.profiles(id),
 client_created_at timestamptz, created_at timestamptz not null default now(), reversed_at timestamptz,
 entity_version bigint not null default 1, unique(unit_id,id),
 foreign key(unit_id,day_id) references public.cash_days(unit_id,id),
 foreign key(unit_id,sale_id,sale_revision) references public.sale_versions(unit_id,sale_id,revision),
 foreign key(unit_id,movement_id) references public.financial_movements(unit_id,id) deferrable initially deferred,
 foreign key(unit_id,reversed_by) references public.financial_movements(unit_id,id),
 check((sale_id is null and target is null and sale_revision is null) or (sale_id is not null and target is not null and sale_revision is not null)),
 check(sale_id is null or category::text=case when target='fee' then 'gas' else target end),
 check((reversed_by is null)=(reversed_at is null))
);
alter table public.financial_movements add constraint movement_receipt foreign key(unit_id,receipt_id)
 references public.debt_receipts(unit_id,id) deferrable initially deferred;
create table public.audit_events (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.operating_units(id),
 operation_id uuid, actor_id uuid not null references public.profiles(id), device_id uuid,
 legacy_user_label text, client_created_at timestamptz, entity_type text not null, entity_id text not null, event_type text not null,
 reason text not null check(length(btrim(reason)) between 1 and 500), before_data jsonb, after_data jsonb,
 created_at timestamptz not null default now(), foreign key(unit_id,device_id) references public.devices(unit_id,id)
);
create table public.sync_operations (
 unit_id uuid not null references public.operating_units(id), id uuid not null, device_id uuid not null,
 actor_id uuid not null references public.profiles(id), command_type text not null, request_hash text not null,
 request_data jsonb not null, response_data jsonb not null, server_version bigint not null,
 created_at timestamptz not null default now(), primary key(unit_id,id), unique(unit_id,server_version),
 foreign key(unit_id,device_id) references public.devices(unit_id,id)
);
create table public.device_pending_operations (
 unit_id uuid not null, id uuid not null, device_id uuid not null, day_id uuid,
 command_type text not null, request_hash text not null, command_data jsonb not null,
 status text not null default 'pending' check(status in ('pending','applied','discarded')),
 discard_reason text, created_at timestamptz not null default now(), resolved_at timestamptz,
 primary key(unit_id,id), foreign key(unit_id,device_id) references public.devices(unit_id,id),
 check(status<>'discarded' or length(btrim(discard_reason)) between 1 and 500)
);
create index pending_by_cash on public.device_pending_operations(unit_id,day_id) where status='pending';
create table public.unit_changes (
 unit_id uuid not null references public.operating_units(id), version bigint not null,
 operation_id uuid, change_type text not null, entity_refs jsonb not null, created_at timestamptz not null default now(),
 primary key(unit_id,version)
);
create table public.close_acknowledgments (
 unit_id uuid not null, day_id uuid not null, round_id uuid not null, device_id uuid not null,
 manifest_generation bigint, acknowledged_at timestamptz,
 primary key(unit_id,round_id,device_id), foreign key(unit_id,day_id) references public.cash_days(unit_id,id),
 foreign key(unit_id,device_id) references public.devices(unit_id,id)
);
create table public.cash_closings (
 id uuid primary key, unit_id uuid not null, day_id uuid not null, round_id uuid not null,
 expected_cash private.cents not null, expected_fund private.cents not null,
 counted_cash private.cents not null, counted_fund private.cents not null,
 cash_difference bigint generated always as (counted_cash::bigint-expected_cash::bigint) stored,
 fund_difference bigint generated always as (counted_fund::bigint-expected_fund::bigint) stored,
 difference bigint generated always as (counted_cash::bigint+counted_fund::bigint-expected_cash::bigint-expected_fund::bigint) stored,
 legacy_user_label text, client_created_at timestamptz, expected jsonb not null, commercial_snapshot jsonb not null, financial_version bigint not null,
 notes text not null default '' check(length(notes)<=500), actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), unique(unit_id,day_id), unique(unit_id,id),
 foreign key(unit_id,day_id) references public.cash_days(unit_id,id),
 check(counted_cash::bigint+counted_fund::bigint<=999999999999),
 check((counted_cash=expected_cash and counted_fund=expected_fund) or length(btrim(notes))>0)
);
alter table public.audit_events add constraint audit_operation foreign key(unit_id,operation_id) references public.sync_operations(unit_id,id) deferrable initially deferred;
alter table public.unit_changes add constraint change_operation foreign key(unit_id,operation_id) references public.sync_operations(unit_id,id) deferrable initially deferred;
-- Falha fechada já na primeira migração, inclusive entre arquivos de deploy.
-- Supabase pode ter default privileges amplos; não depender desses defaults.
do $$ declare t text; begin
 foreach t in array array['operating_units','profiles','unit_memberships','unit_settings','devices','cash_days','sales','sale_drafts','delivery_assignees','deliveries','financial_movements','movement_entries','sale_versions','sale_items','payment_allocations','delivery_fees','debt_receipts','audit_events','sync_operations','device_pending_operations','unit_changes','close_acknowledgments','cash_closings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
 end loop;
end $$;
commit;
