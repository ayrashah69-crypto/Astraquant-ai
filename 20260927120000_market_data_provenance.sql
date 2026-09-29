-- Phase 2: real market-data architecture (schema part).
--
-- Why a schema change is needed:
--  * Existing market_data rows are SYNTHETIC (random walk seeded by the first migration).
--    Real provider candles must never overwrite them or be read back mixed with them, so
--    every row now records where it came from.
--  * The primary key was (symbol, ts). With a provenance column it becomes
--    (symbol, ts, source): synthetic and provider candles for the same date coexist, and
--    re-ingesting the same provider data updates rows in place (no duplicates).
--  * Some real instruments (e.g. FX) have no volume. We must not invent 0, so volume is
--    now nullable.
--
-- Nothing is deleted: every existing row keeps its data and becomes source = 'simulated'.
-- Apply this migration BEFORE deploying code that reads/writes market_data.source.

alter table public.market_data add column if not exists source text not null default 'simulated';

alter table public.market_data alter column volume drop not null;

alter table public.market_data drop constraint if exists market_data_pkey;
alter table public.market_data add constraint market_data_pkey primary key (symbol, ts, source);

alter table public.market_data drop constraint if exists market_data_source_format;
alter table public.market_data add constraint market_data_source_format
  check (source = lower(source) and char_length(source) between 1 and 64);

-- Database-level safety net mirroring the ingestion validator. NOT VALID: enforced for every
-- new/updated row, without re-scanning rows that already exist.
alter table public.market_data drop constraint if exists market_data_ohlc_sane;
alter table public.market_data add constraint market_data_ohlc_sane
  check (
    open > 0 and high > 0 and low > 0 and close > 0
    and high >= greatest(open, close)
    and low <= least(open, close)
    and (volume is null or volume >= 0)
  ) not valid;

-- Saved backtests record which data they ran on. Every pre-existing run used the synthetic
-- dataset, which is exactly what the default backfills.
alter table public.backtest_runs add column if not exists data_source text not null default 'simulated';
