-- Recategorise an Up transaction from Nest.
--
-- `up_category` mirrors Up's fixed category taxonomy, refreshed by up-sync from
-- `GET /categories`. `up-categorise` checks a requested category against it,
-- writes the category back to Up with the caller's own token, and records the
-- change on the local row so the Gifts inbox reflects it straight away.

-- ── up_category: Up's category taxonomy ────────────────────────────────────────

create table public.up_category (
  id text primary key,
  name text not null,
  parent_id text references public.up_category (id)
);

comment on table public.up_category is 'Up''s category taxonomy (GET /categories), shared by every household. A row with a null parent_id is a parent category; only a child can be assigned to a transaction.';
comment on column public.up_category.id is 'Up''s category id, e.g. ''restaurants-and-cafes''.';
comment on column public.up_category.parent_id is 'The parent category''s id; null for a parent category.';

alter table public.up_category enable row level security;

create policy "members read up categories" on public.up_category
  for select to authenticated
  using (true);

grant select on public.up_category to authenticated;

-- ── up-sync: refresh the taxonomy ─────────────────────────────────────────────
--
-- Upserts every category Up lists, parents first so a child's parent_id always
-- resolves. A category Up stops listing is kept: nothing deletes from a fixed
-- taxonomy, and a stored transaction may still name it.

create function public.sync_up_categories(p_rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.up_category as c (id, name, parent_id)
  select r ->> 'id', r ->> 'name', nullif(r ->> 'parent_id', '')
  from jsonb_array_elements(p_rows) as r
  order by (r ->> 'parent_id') is not null
  on conflict (id) do update set
    name = excluded.name,
    parent_id = excluded.parent_id
  where (c.name, c.parent_id) is distinct from (excluded.name, excluded.parent_id);
$$;

-- ── up-categorise: record a written-back category ────────────────────────────
--
-- Sets an Up row's category to `p_category` (a child category, or null to
-- clear it) and its parent from `up_category`, restamping
-- `external_category_since` only when the category changes, exactly as
-- sync_up_transactions does. Returns false when no Up row has the id.

create function public.set_up_transaction_category(p_transaction_id uuid, p_category text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.transactions t set
      external_category = p_category,
      external_parent_category = (
        select c.parent_id from public.up_category c where c.id = p_category
      ),
      external_category_since = case
        when t.external_category is distinct from p_category then now()
        else t.external_category_since
      end
    where t.id = p_transaction_id
      and t.source = 'up'
    returning 1
  )
  select exists (select 1 from updated);
$$;

-- Both run as their owner, so service_role needs no write grant on either
-- table (grants stay surgical — see docs/operations.md).
revoke execute on function public.sync_up_categories(jsonb) from public;
grant execute on function public.sync_up_categories(jsonb) to service_role;
revoke execute on function public.set_up_transaction_category(uuid, text) from public;
grant execute on function public.set_up_transaction_category(uuid, text) to service_role;
