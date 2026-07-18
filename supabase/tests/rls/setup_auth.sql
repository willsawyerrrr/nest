-- CI-only shim of the auth primitives Supabase provides at runtime, so the real
-- migration and its RLS policies can be exercised on a plain Postgres instance.
-- Mirrors Supabase's `auth.uid()` / `auth.jwt()` definitions and the API roles.
-- Not applied to production (Supabase provides the real versions there).

create schema if not exists auth;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text
);

create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create or replace function auth.jwt() returns jsonb
  language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
