-- Notification triggers: the layer that decides WHEN to push.
--
-- The Web Push delivery half already exists (`push_subscription`, the VAPID
-- keypair in Vault, `push-key` / `push-test`). This adds the decision layer: a
-- once-daily evaluator — the `notify-eval` edge function — reads each
-- household's plan, checks four conditions against today's data, and pushes to
-- every member who has a device opted in and has not turned that trigger off.
--
--   buffer_negative           the fortnightly buffer (summarise().afterSaving) < 0
--   goal_eta_slipped          a dated goal's projected completion is past target_date
--   temporary_item_expiring   a temporary_item.target_date is within ~14 days
--   fy_boundary               within ~14 days of 30 June (review the tax configs)
--
-- Two tables:
--   notification_preference — one row per (member, trigger); an absent row means
--     the trigger is on, so a member who never touches the settings is opted in.
--   notification_log — one row per push actually sent, and the dedupe ledger the
--     evaluator consults before sending: a `(member, trigger, dedupe_key)` it
--     already holds is skipped.
--
-- Both tables are member-scoped, NOT household-shared — the same boundary
-- `push_subscription` draws and for the same reason: a preference is the
-- member's own choice about their own phone, and the log records which member
-- was told what. `service_role` (the evaluator) reads both and writes the log.

-- ── trigger enum ─────────────────────────────────────────────────────────────

create type public.notification_trigger as enum (
  'buffer_negative',
  'goal_eta_slipped',
  'temporary_item_expiring',
  'fy_boundary'
);

comment on type public.notification_trigger is 'The four today''s-data conditions notify-eval checks daily. Deposit-landed and bill-due triggers need ingestion and are out of scope here.';

-- ── notification_preference ─────────────────────────────────────────────────

create table public.notification_preference (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  trigger public.notification_trigger not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, trigger),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.notification_preference (household_id);
create index on public.notification_preference (member_id, household_id);

comment on table public.notification_preference is 'One member''s on/off choice for one notification trigger. No row means enabled — a member who never opens the settings receives every trigger.';
comment on column public.notification_preference.enabled is 'False silences this trigger for this member on every device. The evaluator checks it before sending.';

create trigger set_updated_at before update on public.notification_preference
  for each row execute function public.set_updated_at();

-- ── notification_log ────────────────────────────────────────────────────────

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  trigger public.notification_trigger not null,
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  unique (member_id, trigger, dedupe_key),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.notification_log (household_id);
create index on public.notification_log (member_id, trigger, sent_at);

comment on table public.notification_log is 'One row per push notify-eval sent. Its `(member, trigger, dedupe_key)` unique key is the dedupe ledger: a key already present is not re-sent.';
comment on column public.notification_log.dedupe_key is 'What makes a notification "the same one" for its trigger: buffer -> financial year (re-notify after 14 days); goal -> `<goal_id>:<target_date>`; temporary item -> `<item_id>`; FY boundary -> `<financial_year>`.';

-- ── Row-Level Security: own devices/choices only ────────────────────────────
--
-- notification_preference mirrors push_subscription: per-command policies gated
-- on the member, not merely on household membership, so a co-member cannot read
-- or change another member's notification choices.

alter table public.notification_preference enable row level security;

create policy "members read own notification preferences" on public.notification_preference
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members insert own notification preferences" on public.notification_preference
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members update own notification preferences" on public.notification_preference
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members delete own notification preferences" on public.notification_preference
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

-- notification_log carries no `authenticated` policy and no `authenticated`
-- grant: it is the evaluator's private ledger. RLS stays enabled so a stray
-- future grant still denies by default.
alter table public.notification_log enable row level security;

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.notification_preference to authenticated;

-- The evaluator reads every member's preferences and writes the log; it never
-- touches a preference, which only a member's own browser sets.
grant select on public.notification_preference to service_role;
grant select, insert on public.notification_log to service_role;

-- The evaluator also reads the plan tables it reconciles the buffer and goal
-- ETAs from, with a service-role client (the cron caller has no `auth.uid()`
-- for the household's own RLS to match), exactly as `eofy-share` reads the
-- EOFY source tables. `members`, `inflows`, `tax_profile`, `super_contribution`,
-- `help_debt`, and `deduction` are already granted to `service_role` (the
-- EOFY share path); `account_balance` too (the ledger split). These three are
-- the rest of what `summarise` and `projectGoal` need. `budget_line` is read
-- straight — its derived rows are kept canonical by the reconcile triggers, so
-- the evaluator needs neither the breakdown nor the gift tables.
grant select on public.budget_line, public.savings_goal, public.temporary_item
  to service_role;

-- ── Daily evaluator schedule (prod only) ────────────────────────────────────
--
-- On Supabase this schedules a once-daily POST to the deployed `notify-eval`
-- edge function via pg_cron + pg_net, invoked with the service-role key and no
-- user so it evaluates every household. Guarded on both extensions, so on plain
-- Postgres (CI's rls job, local) it is a clean no-op and the migration still
-- applies. The invocation URL and key are read from Vault at run time
-- (`notify_cron_url` / `notify_cron_key`), so rotating the key is a Vault change
-- rather than a migration; when either secret is absent the schedule is skipped.
--
-- 21:00 UTC is ~07:00 AEST / ~08:00 AEDT — a morning alert, before the day is
-- planned around a buffer that has gone negative. Per-member, per-timezone
-- scheduling is a follow-up.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;

    if exists (select 1 from cron.job where jobname = 'notify-eval-daily') then
      perform cron.unschedule('notify-eval-daily');
    end if;

    if exists (select 1 from vault.decrypted_secrets where name = 'notify_cron_url')
       and exists (select 1 from vault.decrypted_secrets where name = 'notify_cron_key') then
      perform cron.schedule(
        'notify-eval-daily',
        '0 21 * * *',
        $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_url'),
          headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_key'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb
        )
        $cron$
      );
    end if;
  end if;
end $$;
