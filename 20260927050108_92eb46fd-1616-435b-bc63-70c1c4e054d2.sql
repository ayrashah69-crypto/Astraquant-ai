
create table public.profiles (
  id uuid primary key,
  display_name text,
  risk_per_trade numeric not null default 2,
  max_position_pct numeric not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = id);

create type public.license_plan as enum ('demo','pro','enterprise');
create type public.license_status as enum ('active','expired','revoked');

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text not null unique,
  user_id uuid not null,
  plan license_plan not null,
  status license_status not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on public.licenses(user_id);
grant select on public.licenses to authenticated;
grant all on public.licenses to service_role;
alter table public.licenses enable row level security;
create policy "own licenses" on public.licenses for select to authenticated using (auth.uid() = user_id);

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  starting_balance numeric not null default 100000,
  cash_balance numeric not null default 100000,
  realized_pnl numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.portfolios to authenticated;
grant all on public.portfolios to service_role;
alter table public.portfolios enable row level security;
create policy "own portfolio" on public.portfolios for select to authenticated using (auth.uid() = user_id);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  symbol text not null,
  quantity numeric not null,
  avg_price numeric not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, symbol)
);
grant select on public.positions to authenticated;
grant all on public.positions to service_role;
alter table public.positions enable row level security;
create policy "own positions" on public.positions for select to authenticated using (auth.uid() = user_id);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  symbol text not null,
  side text not null,
  quantity numeric not null,
  price numeric not null,
  notional numeric not null,
  realized_pnl numeric not null default 0,
  source text not null default 'manual',
  signal_id uuid,
  executed_at timestamptz not null default now()
);
create index on public.trades(user_id, executed_at desc);
grant select on public.trades to authenticated;
grant all on public.trades to service_role;
alter table public.trades enable row level security;
create policy "own trades" on public.trades for select to authenticated using (auth.uid() = user_id);

create table public.ai_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  symbol text not null,
  strategy text not null,
  action text not null,
  confidence numeric not null,
  price numeric not null,
  features jsonb not null default '{}',
  risk_check jsonb not null default '{}',
  rationale text,
  created_at timestamptz not null default now()
);
create index on public.ai_signals(user_id, created_at desc);
grant select on public.ai_signals to authenticated;
grant all on public.ai_signals to service_role;
alter table public.ai_signals enable row level security;
create policy "own signals" on public.ai_signals for select to authenticated using (auth.uid() = user_id);

create table public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  symbol text not null,
  strategy text not null,
  start_date date not null,
  end_date date not null,
  starting_capital numeric not null,
  final_equity numeric not null,
  total_return_pct numeric not null,
  max_drawdown_pct numeric not null,
  win_rate numeric not null,
  total_trades int not null,
  wins int not null,
  losses int not null,
  equity_curve jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.backtest_runs(user_id, created_at desc);
grant select on public.backtest_runs to authenticated;
grant all on public.backtest_runs to service_role;
alter table public.backtest_runs enable row level security;
create policy "own backtests" on public.backtest_runs for select to authenticated using (auth.uid() = user_id);

create table public.market_data (
  symbol text not null,
  ts date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  primary key (symbol, ts)
);
grant select on public.market_data to anon, authenticated;
grant all on public.market_data to service_role;
alter table public.market_data enable row level security;
create policy "public market data" on public.market_data for select to anon, authenticated using (true);

create or replace function public.generate_license_key(_plan license_plan)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare k text; i int;
begin
  loop
    k := 'AQ-' || upper(_plan::text);
    for i in 1..3 loop
      k := k || '-' || upper(substr(encode(gen_random_bytes(4),'hex'),1,4));
    end loop;
    exit when not exists (select 1 from public.licenses where license_key = k);
  end loop;
  return k;
end $$;
revoke execute on function public.generate_license_key(license_plan) from public, anon, authenticated;
grant execute on function public.generate_license_key(license_plan) to service_role;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  insert into public.portfolios(user_id) values (new.id);
  insert into public.licenses(license_key, user_id, plan, expires_at)
    values (public.generate_license_key('demo'), new.id, 'demo', now() + interval '14 days');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

select setseed(0.42);
with syms(symbol, base, vol) as (values
  ('BTC-USD', 42000::float8, 0.035::float8), ('ETH-USD', 2400, 0.04), ('AAPL', 180, 0.015),
  ('MSFT', 380, 0.014), ('NVDA', 480, 0.028), ('TSLA', 240, 0.032),
  ('EUR-USD', 1.09, 0.005), ('GOLD', 2050, 0.009)),
days as (select generate_series(0, 499) as d),
raw as (
  select s.symbol, s.base, s.vol, d.d,
    (random() - 0.49) * 2 * s.vol as ret, random() as r1, random() as r2, random() as r3
  from syms s cross join days d
),
walk as (
  select *, base * exp(sum(ret) over (partition by symbol order by d)) as close_p,
    base * exp(coalesce(sum(ret) over (partition by symbol order by d rows between unbounded preceding and 1 preceding),0)) as open_p
  from raw
)
insert into public.market_data(symbol, ts, open, high, low, close, volume)
select symbol, (current_date - 499 + d)::date,
  round(open_p::numeric, 6), round((greatest(open_p, close_p) * (1 + r1 * vol * 0.5))::numeric, 6),
  round((least(open_p, close_p) * (1 - r2 * vol * 0.5))::numeric, 6), round(close_p::numeric, 6),
  round((1000000 * (0.5 + r3))::numeric)
from walk;
