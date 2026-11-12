-- SOMENTE PostgreSQL efêmero: substitutos mínimos do contexto JWT do Supabase.
-- Não aplicar este arquivo no projeto Supabase, que já possui auth/roles reais.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;

create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
grant execute on function auth.jwt() to authenticated,anon;

-- Simular defaults amplos comuns de hosted Supabase; migrações devem revogá-los.
alter default privileges for role postgres in schema public grant all on tables to anon,authenticated;
