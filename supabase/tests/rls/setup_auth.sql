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

-- Shim of Supabase Vault. On plain Postgres the `supabase_vault` extension is
-- unavailable, so the migration's guard skips creating it; these objects stand
-- in with plaintext storage so the token RPCs and their grants can be exercised.
-- Not applied to production (Supabase provides the real, encrypted Vault there).
create schema if not exists vault;

create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at
    from vault.secrets;

create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default ''
) returns uuid
  language sql
as $$
  insert into vault.secrets (secret, name, description)
    values (new_secret, new_name, coalesce(new_description, ''))
    returning id;
$$;

create or replace function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null
) returns void
  language sql
as $$
  update vault.secrets set
    secret = coalesce(new_secret, secret),
    name = coalesce(new_name, name),
    description = coalesce(new_description, description),
    updated_at = now()
  where id = secret_id;
$$;

-- Shim of Supabase Storage. On plain Postgres the `storage` schema is absent, so
-- each migration's guard skips its bucket and policy block; these objects stand in
-- with the two relations, the columns, and the `foldername` helper those policies
-- read, so the household-scoped Storage RLS is exercised alongside the table
-- policies. Not applied to production (Supabase provides the real Storage there).
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Mirrors Supabase's helper: an object key's folder segments, excluding the file
-- name, so `(storage.foldername(name))[1]` is the leading path segment.
create or replace function storage.foldername(name text) returns text[]
  language sql immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;

-- Shim of the pg_graphql surface. Supabase exposes a `graphql_public` schema
-- whose single `graphql()` function the generated `database.types.ts` carries,
-- so `supabase gen types` run against plain Postgres in CI reproduces that block
-- and the committed file matches byte for byte. The signature mirrors
-- pg_graphql's; the body is irrelevant to type generation. Not applied to
-- production (Supabase provides the real pg_graphql there).
create schema if not exists graphql_public;

create or replace function graphql_public.graphql(
  "operationName" text default null,
  query text default null,
  variables jsonb default null,
  extensions jsonb default null
) returns jsonb
  language sql
as $$
  select '{}'::jsonb
$$;
