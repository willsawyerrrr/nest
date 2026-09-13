-- Hourly Redbark sync schedule, mirroring up-sync's: keep synced bank balances
-- fresh as a backstop to a member's manual refresh.
--
-- On Supabase (prod) this schedules an hourly POST to the deployed
-- `redbark-sync` edge function via pg_cron + pg_net. The function is invoked
-- with the service-role key and no user, so it syncs every household with a
-- Redbark connection (the cron path). The whole thing is guarded on both
-- extensions being available, so on plain Postgres (CI's rls job, local) it is
-- a clean no-op and the migration still applies.
--
-- The invocation URL and key are NOT baked into this migration. The scheduled
-- command reads them from Vault at run time (`redbark_sync_cron_url` and
-- `redbark_sync_cron_key`), so rotating the key is a Vault change, not a
-- migration. When those secrets are absent the schedule is skipped, so an
-- environment without the deploy-time config stays a no-op.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;

    -- Idempotent: drop any existing job so re-running migrations does not
    -- duplicate the schedule.
    if exists (select 1 from cron.job where jobname = 'redbark-sync-hourly') then
      perform cron.unschedule('redbark-sync-hourly');
    end if;

    -- Only schedule when the deploy-time secrets are present; otherwise leave
    -- the environment unscheduled (a safe no-op).
    if exists (select 1 from vault.decrypted_secrets where name = 'redbark_sync_cron_url')
       and exists (select 1 from vault.decrypted_secrets where name = 'redbark_sync_cron_key') then
      perform cron.schedule(
        'redbark-sync-hourly',
        '0 * * * *',
        $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'redbark_sync_cron_url'),
          headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'redbark_sync_cron_key'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb
        )
        $cron$
      );
    end if;
  end if;
end $$;
