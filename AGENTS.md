<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## AstraQuant architecture
- All trading math lives in `src/lib/engine.ts` (pure, deterministic) — shared by signals, risk checks and backtests so results are reproducible.
- Trades/signals/licenses/backtests are written only by server functions via the admin client after auth; tables expose owner-only SELECT to users — prevents clients forging balances or licenses.
- Order execution goes through the `ExecutionAdapter` interface in `src/lib/execution.server.ts`; only `PaperBroker` exists — live brokers must be added as a separate adapter after compliance review.
- Quotes come from `src/lib/market.server.ts`, which now delegates to a provider adapter in real mode (simulated intraday oscillation only when `MARKET_DATA_MODE=simulated`) — see "Market data (Phase 2)" below.

## Paper trading safety (Phase 1)
- All trades are virtual. There is no live-broker adapter registered; `PaperBroker` in `src/lib/execution.server.ts` is the only `ExecutionAdapter`.
- Every authoritative value — price, cash balance, position quantity, fees, P/L — is computed and validated server-side. The browser only ever sends `{ symbol, side, quantity }`; it cannot supply a price, balance, or P/L.
- **Risk checks apply to both signal-generated and manually entered trades.** `src/lib/trading.functions.ts: assessTradeRisk()` runs the same `engine.ts: riskCheck()` used by `generateSignal()` before any `executePaperTrade()` call is allowed to reach the broker, so a manual order can no longer bypass the account's risk-per-trade %, max-position % and volatility limits the way it originally could. `previewPaperTrade()` exposes this same check read-only, for the Order Ticket's pre-submit risk status — it is advisory only and never trusted as authorization; `executePaperTrade()` always re-runs the real check itself.
- **Concurrent portfolio updates are protected at the database level**, not just by disabling a button in the UI. `execute_paper_trade()` (see `supabase/migrations/20260927060000_add_execute_paper_trade_function.sql`) performs the entire read → validate → write sequence inside one Postgres function, taking a row lock (`for update`) on the caller's portfolio before reading or mutating anything. A second concurrent trade for the same user blocks until the first commits, then evaluates cash/position limits against the true post-trade state — two simultaneous orders can never both spend the same cash or oversell the same position. A `lock_timeout` bounds how long a call waits, surfacing a clear `CONCURRENT_CONFLICT` error instead of hanging. Only the service-role client may call this function (see the `revoke`/`grant` at the bottom of that migration); a user's own session can never invoke it directly.
- Errors from the trade path are raised as `CODE: message` from Postgres and re-thrown as a typed `TradeError` (`src/lib/execution.server.ts`) with a stable `.code` (e.g. `INSUFFICIENT_CASH`, `INSUFFICIENT_POSITION`, `CONCURRENT_CONFLICT`, `RISK_LIMIT_EXCEEDED`, `LICENSE_REQUIRED`) so callers can branch on failure reason without parsing free-form text or seeing raw database internals.
- Focused unit tests for the risk-check scenarios above live in `src/lib/engine.test.ts` (`npm test` — uses Node's built-in test runner via `--experimental-strip-types`, no extra dependency). They cover pure `riskCheck()` logic only; the database-level locking is verified by code review of the migration SQL, since exercising real concurrent transactions requires a live Postgres/Supabase instance.

## Market data (Phase 2)

**Paper trading stays separate from market-data ingestion.** Ingestion only writes `market_data`; it never touches portfolios, positions, trades or licenses. Order execution is still `PaperBroker` only — no broker, no real orders.

### Architecture
```
External provider ──► adapter (market-provider.server.ts) ──► market_data (source = provider id)
                                                                   │
                     quotes: provider, cached ─► market.server.ts ◄┘  (stored candles)
                                                        │
                        trading.functions.ts ─► engine.ts (unchanged) ─► signals / backtests ─► PaperBroker
```
- `src/lib/market-config.server.ts` — reads env vars (mode, provider id, key, timeouts). Names missing variables in errors, never values.
- `src/lib/market-provider.server.ts` — `MarketDataProvider` interface (`getQuote`, `getQuotes`, `getHistoricalCandles`) + the Twelve Data adapter. Returns internal shapes; nothing else knows which vendor is used. To add a vendor: implement the interface and register it in `REGISTRY` and `SUPPORTED_PROVIDERS`.
- `src/lib/market.server.ts` — `getQuotes`/`getQuote` (cached provider quotes in real mode), `getStoredCandles` (stored history only), `accountEquity`.
- `src/lib/market-ingest.server.ts` — validate → normalize → upsert. `src/routes/api/public/market-ingest.ts` — scheduled entry point.
- `src/lib/market-status.ts` — client-safe `MarketDataError` + the status/labels the UI shows. Everything else market-related is `*.server.ts`; `symbols.ts` is the client-safe symbol list.

### Real vs simulated mode (`MARKET_DATA_MODE`)
- `real` (default when unset): prices come from the provider. If the provider is unconfigured, unreachable, rate-limited or returns garbage, callers get a `MarketDataError` / an explicit "MARKET DATA UNAVAILABLE" state. **There is no fallback to synthetic prices.** A short in-process quote cache (`MARKET_DATA_QUOTE_TTL_SECONDS`, default 60) only reuses *real* quotes.
- `simulated`: the original synthetic behaviour (`simulatedPrice()` over the synthetic history). Labelled `SIMULATED MARKET DATA` everywhere.
- The two never mix: `market_data.source` is `'simulated'` for the synthetic rows and the provider id for provider rows, and every read filters on the active source. Backtests record `backtest_runs.data_source`.
- In real mode, quote volatility is computed from **stored real candles**; with fewer than 2 recent stored candles a symbol reports `NO_MARKET_DATA` until ingestion has run.
- Real-mode wording never says "live"/"real-time": timing depends on the provider plan and market hours (`asOf` is the provider's own timestamp).
- A held symbol whose quote is missing is an error for equity/risk maths (`accountEquity`), never "worth 0"; the dashboard flips to "unavailable" and values that position at cost.

### Environment variables (server-side only — see `.env.example`)
`MARKET_DATA_MODE`, `MARKET_DATA_PROVIDER` (`twelvedata`), `MARKET_DATA_API_KEY`, `MARKET_DATA_TIMEOUT_MS`, `MARKET_DATA_QUOTE_TTL_SECONDS`, `LOVABLE_CRON_SECRET` (+ optional `LOVABLE_CRON_SECRET_PREVIOUS`), plus the existing `SUPABASE_SERVICE_ROLE_KEY`.

### Provider API key rules
Never in React components, `VITE_*` variables, source, database rows or client bundles. Provider modules are `*.server.ts` and imported lazily inside server handlers. Errors are written by us: they never contain the key, request URL, provider response body or stack traces (covered by tests). The Twelve Data adapter currently sends the key as an `apikey` query parameter, so never log request URLs.

### Ingestion flow
1. Scheduler POSTs `/api/public/market-ingest` with `Authorization: Bearer <LOVABLE_CRON_SECRET>` (`cron-auth.ts`, constant-time compare). Anything else → 401.
2. Per symbol: start = newest stored provider candle − 3 days (or a ~500-day backfill when none), end = today (UTC).
3. Validate each candle (real calendar date, prices > 0, `high ≥ max(open, close)`, `low ≤ min(open, close)`, volume ≥ 0 or absent). Malformed rows are rejected, counted and never repaired. Candles dated today or later are skipped as incomplete, so only finished daily bars are stored. A missing volume stays `NULL` (never invented).
4. Upsert on `(symbol, ts, source)`; re-runs update in place, no duplicates. The migration also adds a `NOT VALID` OHLC check constraint as a database safety net.
5. Response is a per-symbol JSON summary. Rate-limit or bad-key errors stop the run; a symbol the plan doesn't cover (403) only fails that symbol.
Optional body: `{"symbols": ["AAPL"], "days": 30}`.

### Scheduling
`supabase/cron/schedule-market-ingestion.example.sql` is a **template** (pg_cron + pg_net + Vault) — not a migration, not executed or verified here. Suggested cadence: daily at 00:30 UTC. Apply `supabase/migrations/20260927120000_market_data_provenance.sql` *before* deploying this code. `src/routeTree.gen.ts` is generated: it picks up the new route on the next `vite dev`/`vite build`.

### Known limits
Daily candles only (`market_data.ts` is a `date`). Ranged candle reads return at most 1000 rows. Twelve Data symbol/plan coverage (e.g. `XAU/USD` for GOLD) depends on your plan. The adapter was written from the provider's documented API and has **not** been exercised against the live service.
