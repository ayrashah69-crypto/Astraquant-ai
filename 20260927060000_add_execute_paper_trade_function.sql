-- Phase 1 fix: atomic, concurrency-safe paper trade execution.
--
-- Previously PaperBroker.submit() did read -> calculate in application code -> write,
-- across several separate statements. Two near-simultaneous submissions for the same
-- user (double-click, multiple tabs) could both read the same cash_balance/position
-- quantity and both succeed, double-spending virtual cash or over-selling a position.
--
-- This function makes the whole read-validate-write sequence a single atomic
-- transaction. SELECT ... FOR UPDATE takes a row lock on the caller's portfolio (and,
-- if present, their position in this symbol) so a second concurrent call for the same
-- user blocks until the first commits, then re-reads the now-current balance/quantity.
-- A short lock_timeout turns a stuck/blocked concurrent call into a clear
-- CONCURRENT_CONFLICT error instead of hanging indefinitely.
--
-- Errors are raised as 'ERROR_CODE: human message' so the TypeScript layer
-- (src/lib/execution.server.ts) can surface a stable machine-readable code without
-- parsing arbitrary Postgres error text.
create or replace function public.execute_paper_trade(
  _user_id uuid,
  _symbol text,
  _side text,
  _quantity numeric,
  _price numeric,
  _fee_rate numeric,
  _source text,
  _signal_id uuid
) returns table (
  trade_id uuid,
  fill_price numeric,
  fill_quantity numeric,
  realized_pnl numeric,
  cash_after numeric
)
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  -- %rowtype (not `record`) so that a SELECT ... INTO which matches zero rows (e.g. no
  -- existing position for this symbol yet) leaves every field NULL and readable —
  -- `record`-typed variables instead raise "record is not assigned yet" the moment any
  -- field is accessed after a zero-row select, which would incorrectly hard-fail every
  -- first-time BUY of a symbol.
  pf public.portfolios%rowtype;
  pos public.positions%rowtype;
  notional numeric;
  fee numeric;
  cash numeric;
  realized numeric := 0;
  new_qty numeric;
  new_avg numeric;
  out_trade_id uuid;
begin
  -- Don't let a stuck lock hang the request forever; fail fast and clearly instead.
  set local lock_timeout = '3s';

  if _quantity is null or _quantity <= 0 then
    raise exception 'INVALID_QUANTITY: Quantity must be a positive number';
  end if;
  if _side is null or _side not in ('BUY', 'SELL') then
    raise exception 'INVALID_SIDE: Side must be BUY or SELL';
  end if;
  if _price is null or _price <= 0 then
    raise exception 'MARKET_DATA_UNAVAILABLE: No valid price available for %', coalesce(_symbol, 'symbol');
  end if;

  begin
    select * into pf from public.portfolios where user_id = _user_id for update;
  exception when lock_not_available then
    raise exception 'CONCURRENT_CONFLICT: Another trade for this account is still processing, please retry';
  end;
  if not found then
    raise exception 'PORTFOLIO_NOT_FOUND: Portfolio not found';
  end if;

  begin
    select * into pos from public.positions where portfolio_id = pf.id and symbol = _symbol for update;
  exception when lock_not_available then
    raise exception 'CONCURRENT_CONFLICT: Another trade for this account is still processing, please retry';
  end;

  notional := _price * _quantity;
  fee := notional * _fee_rate;
  cash := pf.cash_balance;

  if _side = 'BUY' then
    if notional + fee > cash + 1e-6 then
      raise exception 'INSUFFICIENT_CASH: Insufficient virtual cash (need %)', round(notional + fee, 2);
    end if;
    cash := cash - notional - fee;
    if pos.id is not null then
      new_qty := pos.quantity + _quantity;
      new_avg := (pos.quantity * pos.avg_price + notional) / new_qty;
      update public.positions
        set quantity = new_qty, avg_price = new_avg, updated_at = now()
        where id = pos.id;
    else
      insert into public.positions(user_id, portfolio_id, symbol, quantity, avg_price)
      values (_user_id, pf.id, _symbol, _quantity, _price);
    end if;
    realized := -fee;
  else
    if pos.id is null or _quantity > pos.quantity + 1e-9 then
      raise exception 'INSUFFICIENT_POSITION: Cannot sell %, you hold %', _quantity, coalesce(pos.quantity, 0);
    end if;
    cash := cash + notional - fee;
    realized := (_price - pos.avg_price) * _quantity - fee;
    if pos.quantity - _quantity <= 1e-9 then
      delete from public.positions where id = pos.id;
    else
      update public.positions
        set quantity = pos.quantity - _quantity, updated_at = now()
        where id = pos.id;
    end if;
  end if;

  update public.portfolios
    set cash_balance = cash, realized_pnl = pf.realized_pnl + realized, updated_at = now()
    where id = pf.id;

  insert into public.trades(user_id, portfolio_id, symbol, side, quantity, price, notional, realized_pnl, source, signal_id)
  values (_user_id, pf.id, _symbol, _side, _quantity, _price, notional, realized, _source, _signal_id)
  returning id into out_trade_id;

  return query select out_trade_id, _price, _quantity, realized, cash;
end;
$$;

-- Same access pattern as generate_license_key: only the service-role admin client
-- (used exclusively inside authenticated, license-checked server functions) may call
-- this. A user's own RLS-scoped session can never invoke it directly.
revoke execute on function public.execute_paper_trade(uuid, text, text, numeric, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.execute_paper_trade(uuid, text, text, numeric, numeric, numeric, text, uuid) to service_role;
