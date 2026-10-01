-- TEMPLATE ONLY - deliberately NOT in supabase/migrations/, so it never runs automatically and
-- no secret ever lands in migration history. It has NOT been executed or verified in the
-- environment this repo was prepared in. Review, edit the placeholders, then run it yourself
-- (Supabase SQL editor) once the app is deployed and the env vars in .env.example are set.
--
-- What it does: once a day, POST to the ingestion route with the shared cron secret.
-- Schedule rationale: ingestion only stores COMPLETED daily candles (dated before today, UTC),
-- so it runs shortly after 00:00 UTC to pick up the previous day.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the secret in Vault (run ONCE; use the same value as the app's LOVABLE_CRON_SECRET).
-- select vault.create_secret('PASTE_THE_SAME_VALUE_AS_LOVABLE_CRON_SECRET', 'astraquant_cron_secret');

select cron.schedule(
  'astraquant-market-ingest',
  '30 0 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP-DOMAIN/api/public/market-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'astraquant_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Inspect / remove:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;   -- shows the HTTP call ran, not whether ingestion succeeded
--   select * from net._http_response order by created desc limit 5;         -- the route's JSON summary
--   select cron.unschedule('astraquant-market-ingest');
--
-- First population: an empty body backfills ~500 calendar days per symbol. For a longer window
-- or one symbol, POST {"days": 800} or {"symbols": ["AAPL"], "days": 30}.
