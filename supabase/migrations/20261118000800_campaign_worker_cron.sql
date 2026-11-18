-- Run the campaign worker every 5 minutes: it starts scheduled campaigns and keeps sending queued
-- recipients within Resend's limits. The shared secret lives in Supabase Vault ('campaign_worker_secret'),
-- set outside of git with: select vault.create_secret('<secret>', 'campaign_worker_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'campaign-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://whtbouubrvqanmxtyabz.supabase.co/functions/v1/campaign-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'campaign_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
