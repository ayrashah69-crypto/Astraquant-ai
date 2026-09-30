// Tests for the market-data layer (Phase 2).
//
// Run with `npm test`. Everything here uses injected doubles — an in-memory fake of the
// Supabase query builder and fake `fetch`/provider objects — so NO network call is made and
// NO real provider is contacted. These tests therefore prove our parsing, validation,
// mode-selection and error behaviour; they do NOT prove that the real provider's API still
// returns the shapes we coded against, nor that Postgres enforces the primary key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketDataError } from "./market-status.ts";
import { getMarketDataMode, getProviderConfig, getProviderId, getQuoteTtlMs } from "./market-config.server.ts";
import { createMarketProvider, TWELVE_DATA_SYMBOLS, TwelveDataProvider } from "./market-provider.server.ts";
import type { MarketDataProvider, ProviderQuote, RawCandle } from "./market-provider.server.ts";
import { ingestSymbol, normalizeCandles, runIngestion, validateCandle } from "./market-ingest.server.ts";
import { accountEquity, currentMarketStatus, getQuote, getQuotes, getQuotesWithStatus, getStoredCandles, resetQuoteCache, unavailableStatus } from "./market.server.ts";
import { QUOTE_STALE_AFTER_MS, quoteFreshness } from "./market-status.ts";
import { SYMBOLS } from "./symbols.ts";
import { handleIngestRequest, parseIngestBody } from "./market-ingest-handler.server.ts";

const SECRET = "sk_test_SUPER_SECRET_KEY_123";
const TODAY = "2026-09-28";

// ---------- fakes -------------------------------------------------------------------

type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const log: { table: string; op: string; args?: unknown }[] = [];
  const keyOf = (table: string, r: Row) => (table === "market_data" ? `${r["symbol"]}|${r["ts"]}|${r["source"]}` : JSON.stringify(r));
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { col: string; asc: boolean } | null = null;
    let max = Infinity;
    const b: Record<string, unknown> = {
      select: (cols: string) => { log.push({ table, op: "select", args: cols }); return b; },
      eq: (c: string, v: unknown) => { log.push({ table, op: "eq", args: [c, v] }); filters.push((r) => r[c] === v); return b; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; },
      lte: (c: string, v: string) => { filters.push((r) => String(r[c]) <= v); return b; },
      order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { max = n; return b; },
      upsert: async (rows: Row[], opts: { onConflict: string }) => {
        log.push({ table, op: "upsert", args: { n: rows.length, onConflict: opts.onConflict } });
        const t = (tables[table] ??= []);
        for (const r of rows) {
          const i = t.findIndex((x) => keyOf(table, x) === keyOf(table, r));
          if (i >= 0) t[i] = { ...r }; else t.push({ ...r });
        }
        return { error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (order) { const { col, asc } = order; out = [...out].sort((a, z) => (String(a[col]) < String(z[col]) ? -1 : 1) * (asc ? 1 : -1)); }
        return resolve({ data: out.slice(0, max), error: null });
      },
    };
    return b;
  }
  return { db: { from } as never, tables, log };
}

const md = (symbol: string, ts: string, close: number, source: string): Row => ({ symbol, ts, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000, source });
const history = (symbol: string, source: string, base: number, n = 30): Row[] =>
  Array.from({ length: n }, (_, i) => md(symbol, `2026-09-${String(i + 1).padStart(2, "0")}`.slice(0, 10), base + i, source)).filter((r) => String(r["ts"]) <= "2026-09-27");

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const provider = (fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs = 500) => new TwelveDataProvider({ apiKey: SECRET, timeoutMs, fetchImpl });

const raw = (o: Partial<RawCandle> = {}): RawCandle => ({ symbol: "AAPL", ts: "2026-09-25", open: 100, high: 102, low: 99, close: 101, volume: 5000, ...o });

// ---------- 1. provider response normalization --------------------------------------

test("Twelve Data adapter: normalizes time_series strings into numeric candles, volume stays null when absent", async () => {
  const seen: string[] = [];
  const p = provider(async (url) => {
    seen.push(url);
    return jsonRes({ status: "ok", values: [
      { datetime: "2026-09-24", open: "100.5", high: "102", low: "99.25", close: "101", volume: "12345" },
      { datetime: "2026-09-25 00:00:00", open: "101", high: "103", low: "100", close: "102" },
    ] });
  });
  const out = await p.getHistoricalCandles("EUR-USD", "2026-09-01", "2026-09-27");
  assert.deepEqual(out[0], { symbol: "EUR-USD", ts: "2026-09-24", open: 100.5, high: 102, low: 99.25, close: 101, volume: 12345 });
  assert.equal(out[1]!.ts, "2026-09-25", "time-of-day suffix is trimmed to a date");
  assert.equal(out[1]!.volume, null, "missing volume must stay null, never 0");
  assert.ok(seen[0]!.includes("symbol=EUR%2FUSD"), "internal symbol is mapped to the provider symbol");
});

test("Twelve Data adapter: quote uses the provider's own timestamp and previous close", async () => {
  const p = provider(async () => jsonRes({ symbol: "AAPL", close: "190.10", previous_close: "188.00", timestamp: 1790500000 }));
  const q = await p.getQuote("AAPL");
  assert.equal(q.price, 190.1);
  assert.equal(q.prevClose, 188);
  assert.equal(q.asOf, new Date(1790500000 * 1000).toISOString());
});

test("Twelve Data adapter: incomplete quote is rejected rather than guessed", async () => {
  const p = provider(async () => jsonRes({ symbol: "AAPL", close: "190.10" })); // no timestamp
  await assert.rejects(() => p.getQuote("AAPL"), (e: unknown) => e instanceof MarketDataError && e.code === "PROVIDER_INVALID_RESPONSE");
});

// ---------- 2. provider error handling ----------------------------------------------

test("Twelve Data adapter: maps rate limit, auth, timeout, bad payload and unsupported symbol", async () => {
  const code = async (f: (u: string, i?: RequestInit) => Promise<Response>, sym = "AAPL") => {
    try { await provider(f).getQuote(sym); return "no error"; } catch (e) { return e instanceof MarketDataError ? e.code : `other:${String(e)}`; }
  };
  assert.equal(await code(async () => jsonRes({ status: "error", code: 429, message: "x" }, 429)), "PROVIDER_RATE_LIMITED");
  assert.equal(await code(async () => jsonRes({ status: "error", code: 401, message: "x" }, 401)), "PROVIDER_AUTH_FAILED");
  assert.equal(await code(async () => jsonRes({ status: "error", code: 429 }, 200)), "PROVIDER_RATE_LIMITED", "error inside a 200 body");
  assert.equal(await code(async () => new Response("<html>oops</html>", { status: 200 })), "PROVIDER_INVALID_RESPONSE");
  assert.equal(await code(async () => jsonRes({}, 503)), "PROVIDER_ERROR");
  assert.equal(await code(async () => { throw new Error(`connect ECONNREFUSED https://x?apikey=${SECRET}`); }), "PROVIDER_ERROR");
  assert.equal(await code(async () => jsonRes({}), "NOT-A-SYMBOL"), "UNSUPPORTED_SYMBOL");
  const hang = (_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  assert.equal(await (async () => { try { await provider(hang, 30).getQuote("AAPL"); return "no error"; } catch (e) { return (e as MarketDataError).code; } })(), "PROVIDER_TIMEOUT");
});

test("errors never contain the API key, request URL or underlying exception text", async () => {
  const boom = async () => { throw new Error(`fetch failed https://api.twelvedata.com/quote?apikey=${SECRET}`); };
  for (const attempt of [() => provider(boom).getQuote("AAPL"), () => provider(async () => jsonRes({ status: "error", code: 401, message: SECRET }, 401)).getQuote("AAPL")]) {
    await assert.rejects(attempt, (e: unknown) => {
      const m = (e as Error).message + JSON.stringify(e);
      assert.ok(!m.includes(SECRET) && !m.includes("apikey") && !m.includes("https://"), m);
      return true;
    });
  }
});

// ---------- 3. OHLC validation -------------------------------------------------------

test("validateCandle accepts a sane completed candle and rejects each malformed case", () => {
  const ctx = { symbol: "AAPL", today: TODAY };
  const reason = (c: RawCandle) => { const v = validateCandle(c, ctx); return v.ok ? "ok" : v.reason; };
  assert.equal(reason(raw()), "ok");
  assert.equal(reason(raw({ volume: null })), "ok", "volume is optional");
  assert.equal(reason(raw({ symbol: "MSFT" })), "symbol_mismatch");
  assert.equal(reason(raw({ ts: "2026-02-30" })), "invalid_timestamp");
  assert.equal(reason(raw({ ts: "yesterday" })), "invalid_timestamp");
  assert.equal(reason(raw({ ts: TODAY })), "incomplete_or_future");
  assert.equal(reason(raw({ ts: "2027-01-01" })), "incomplete_or_future");
  assert.equal(reason(raw({ open: NaN })), "invalid_price");
  assert.equal(reason(raw({ low: 0 })), "invalid_price");
  assert.equal(reason(raw({ close: -1 })), "invalid_price");
  assert.equal(reason(raw({ high: 100.5 })), "ohlc_inconsistent", "high below close");
  assert.equal(reason(raw({ low: 100.5 })), "ohlc_inconsistent", "low above open");
  assert.equal(reason(raw({ volume: -5 })), "invalid_volume");
  assert.equal(reason(raw({ volume: NaN })), "invalid_volume");
});

// ---------- 4. duplicate handling ----------------------------------------------------

test("normalizeCandles: drops in-batch duplicates (last wins), skips today's bar, counts rejects, never invents values", () => {
  const n = normalizeCandles(
    [raw({ ts: "2026-09-24", close: 100 }), raw({ ts: "2026-09-24", close: 101, high: 103 }), raw({ ts: TODAY }), raw({ ts: "2026-09-23", low: 0 }), raw({ ts: "2026-09-22" })],
    { symbol: "AAPL", source: "twelvedata", today: TODAY },
  );
  assert.deepEqual(n.rows.map((r) => r.ts), ["2026-09-22", "2026-09-24"], "sorted ascending, one row per date");
  assert.equal(n.rows[1]!.close, 101, "last duplicate wins");
  assert.equal(n.duplicates, 1);
  assert.equal(n.skippedIncomplete, 1);
  assert.equal(n.rejected, 1);
  assert.deepEqual(n.rejectedByReason, { invalid_price: 1 });
  assert.ok(n.rows.every((r) => r.source === "twelvedata"));
});

test("ingestSymbol is idempotent: running twice leaves one row per (symbol, ts, source) and does not touch simulated rows", async () => {
  const { db, tables, log } = fakeDb({ market_data: [md("AAPL", "2026-09-24", 50, "simulated")] });
  const candles = [raw({ ts: "2026-09-24" }), raw({ ts: "2026-09-25" })];
  const p: MarketDataProvider = { ...stubProvider(), getHistoricalCandles: async () => candles };
  const now = new Date(`${TODAY}T12:00:00Z`);
  await ingestSymbol(db, p, "AAPL", { start: "2026-09-01", end: TODAY }, now);
  await ingestSymbol(db, p, "AAPL", { start: "2026-09-01", end: TODAY }, now);
  const rows = tables["market_data"]!;
  assert.equal(rows.length, 3, "1 simulated + 2 provider rows, no duplicates after two runs");
  assert.equal(rows.filter((r) => r["source"] === "simulated").length, 1);
  assert.equal(rows.find((r) => r["source"] === "simulated")!["close"], 50, "synthetic row untouched even though the date overlaps");
  const up = log.filter((l) => l.op === "upsert");
  assert.deepEqual((up[0]!.args as { onConflict: string }).onConflict, "symbol,ts,source", "conflict target matches the primary key in the migration");
});

test("runIngestion: incremental start comes from the newest stored provider row; rate limit aborts remaining symbols", async () => {
  const { db } = fakeDb({ market_data: [md("AAPL", "2026-09-20", 100, "twelvedata"), md("MSFT", "2026-09-25", 100, "simulated")] });
  const calls: { s: string; start: string }[] = [];
  const p: MarketDataProvider = {
    ...stubProvider(),
    getHistoricalCandles: async (s, start) => {
      calls.push({ s, start });
      if (s === "MSFT") throw new MarketDataError("PROVIDER_RATE_LIMITED", "limited");
      return [];
    },
  };
  const summary = await runIngestion(db, p, { symbols: ["AAPL", "MSFT", "NVDA"], now: new Date(`${TODAY}T12:00:00Z`), log: () => {} });
  assert.equal(calls[0]!.start, "2026-09-17", "newest stored AAPL provider row (09-20) minus 3-day overlap");
  assert.equal(calls[1]!.start, "2025-05-16", "MSFT has only simulated rows, so it backfills 500 days");
  assert.equal(calls.length, 2, "NVDA never requested after the rate limit");
  assert.equal(summary.ok, false);
  assert.match(summary.aborted ?? "", /PROVIDER_RATE_LIMITED/);
});

// ---------- 5. provider-not-configured / config --------------------------------------

test("config: provider not configured produces a clear error that names variables, not values", () => {
  for (const env of [{}, { MARKET_DATA_PROVIDER: "twelvedata" }, { MARKET_DATA_API_KEY: SECRET }]) {
    assert.throws(() => createMarketProvider(env), (e: unknown) => {
      assert.ok(e instanceof MarketDataError && e.code === "PROVIDER_NOT_CONFIGURED");
      assert.ok(/MARKET_DATA_/.test(e.message) && !e.message.includes(SECRET));
      return true;
    });
  }
  assert.throws(() => getProviderConfig({ MARKET_DATA_PROVIDER: "nope", MARKET_DATA_API_KEY: SECRET }), (e: unknown) => e instanceof MarketDataError && e.code === "INVALID_CONFIG" && !e.message.includes(SECRET));
  assert.equal(getProviderId({ MARKET_DATA_PROVIDER: " TwelveData " }), "twelvedata");
  assert.equal(createMarketProvider({ MARKET_DATA_PROVIDER: "twelvedata", MARKET_DATA_API_KEY: SECRET }).id, "twelvedata");
});

test("config: mode defaults to real, accepts real/simulated, rejects anything else (no silent default)", () => {
  assert.equal(getMarketDataMode({}), "real");
  assert.equal(getMarketDataMode({ MARKET_DATA_MODE: "Simulated" }), "simulated");
  assert.throws(() => getMarketDataMode({ MARKET_DATA_MODE: "sim" }), (e: unknown) => e instanceof MarketDataError && e.code === "INVALID_CONFIG");
  assert.equal(getQuoteTtlMs({}), 60_000);
  assert.equal(getQuoteTtlMs({ MARKET_DATA_QUOTE_TTL_SECONDS: "0" }), 0);
});

// ---------- 6. simulated mode --------------------------------------------------------

function stubProvider(over: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    id: "twelvedata",
    displayName: "Twelve Data",
    getQuote: async () => { throw new Error("stub"); },
    getQuotes: async () => ({ quotes: [], failures: [] }),
    getHistoricalCandles: async () => [],
    ...over,
  };
}

test("simulated mode: uses only simulated rows, labels quotes 'simulated', never calls a provider", async () => {
  resetQuoteCache();
  const { db, log } = fakeDb({ market_data: [...history("AAPL", "simulated", 100), ...history("AAPL", "twelvedata", 900)] });
  let providerCalls = 0;
  const p = stubProvider({ getQuotes: async () => { providerCalls++; return { quotes: [], failures: [] }; } });
  const q = await getQuote(db, "AAPL", { env: { MARKET_DATA_MODE: "simulated" }, provider: p });
  assert.equal(q.source, "simulated");
  assert.ok(q.prevClose < 200, "prevClose came from the simulated rows (100s), not the provider rows (900s)");
  assert.equal(providerCalls, 0);
  assert.ok(log.some((l) => l.op === "eq" && (l.args as string[])[1] === "simulated"));
  assert.equal(currentMarketStatus([], { env: { MARKET_DATA_MODE: "simulated" } }).label, "SIMULATED MARKET DATA");
});

// ---------- 7. real mode -------------------------------------------------------------

const realEnv = { MARKET_DATA_MODE: "real", MARKET_DATA_PROVIDER: "twelvedata", MARKET_DATA_API_KEY: SECRET, MARKET_DATA_QUOTE_TTL_SECONDS: "60" };
const goodQuote = (s: string, price: number): ProviderQuote => ({ symbol: s, price, prevClose: 199, asOf: "2026-09-27T20:00:00.000Z", marketOpen: true });

test("real mode: returns the provider price and provider timestamp, labelled 'real' (volatility from stored real candles)", async () => {
  resetQuoteCache();
  const { db } = fakeDb({ market_data: [...history("AAPL", "simulated", 100), ...history("AAPL", "twelvedata", 200)] });
  const p = stubProvider({ getQuotes: async (syms) => ({ quotes: syms.map((s) => goodQuote(s, 205.5)), failures: [] }) });
  const q = await getQuote(db, "AAPL", { env: realEnv, provider: p });
  assert.equal(q.source, "real");
  assert.equal(q.price, 205.5);
  assert.equal(q.asOf, "2026-09-27T20:00:00.000Z", "asOf is the provider's timestamp, not fetch time");
  assert.equal(q.prevClose, 199);
  assert.ok(q.volatility > 0);
  const status = currentMarketStatus([q], { env: realEnv });
  assert.equal(status.label, "REAL MARKET DATA");
  assert.ok(!/live|real-time|realtime/i.test(status.detail), "no unqualified live/real-time claims");
});

test("real mode: provider failure THROWS — it never falls back to simulated prices", async () => {
  resetQuoteCache();
  // Simulated rows exist and would be perfectly usable for a fallback; the point is that they must not be.
  const { db } = fakeDb({ market_data: [...history("AAPL", "simulated", 100), ...history("AAPL", "twelvedata", 200)] });
  const down = stubProvider({ getQuotes: async () => { throw new MarketDataError("PROVIDER_TIMEOUT", "timed out"); } });
  await assert.rejects(() => getQuote(db, "AAPL", { env: realEnv, provider: down }), (e: unknown) => e instanceof MarketDataError && e.code === "PROVIDER_TIMEOUT");
  await assert.rejects(() => getQuotes(db, ["AAPL"], { env: realEnv, provider: down }), (e: unknown) => e instanceof MarketDataError);

  const failing = stubProvider({ getQuotes: async (syms) => ({ quotes: [], failures: syms.map((symbol) => ({ symbol, error: new MarketDataError("PROVIDER_RATE_LIMITED", "limited") })) }) });
  resetQuoteCache();
  await assert.rejects(() => getQuotes(db, ["AAPL"], { env: realEnv, provider: failing }), (e: unknown) => e instanceof MarketDataError && e.code === "PROVIDER_RATE_LIMITED");
});

test("real mode: not configured throws PROVIDER_NOT_CONFIGURED; no stored real history throws NO_MARKET_DATA (simulated rows ignored)", async () => {
  resetQuoteCache();
  const { db } = fakeDb({ market_data: history("AAPL", "simulated", 100) });
  await assert.rejects(() => getQuote(db, "AAPL", { env: { MARKET_DATA_MODE: "real" } }), (e: unknown) => e instanceof MarketDataError && e.code === "PROVIDER_NOT_CONFIGURED");
  const p = stubProvider({ getQuotes: async () => { throw new Error("must not be called without history"); } });
  await assert.rejects(() => getQuote(db, "AAPL", { env: realEnv, provider: p }), (e: unknown) => e instanceof MarketDataError && e.code === "NO_MARKET_DATA");
  assert.equal(currentMarketStatus([], { env: { MARKET_DATA_MODE: "real" } }).state, "unavailable");
});

test("real mode: partial failure keeps the good symbols; quote cache avoids repeat provider calls within the TTL", async () => {
  resetQuoteCache();
  const { db } = fakeDb({ market_data: [...history("AAPL", "twelvedata", 200), ...history("MSFT", "twelvedata", 400)] });
  let calls = 0;
  const p = stubProvider({
    getQuotes: async (syms) => {
      calls++;
      return { quotes: syms.filter((s) => s === "AAPL").map((s) => goodQuote(s, 205)), failures: syms.filter((s) => s !== "AAPL").map((symbol) => ({ symbol, error: new MarketDataError("NO_MARKET_DATA", "none") })) };
    },
  });
  const out = await getQuotes(db, ["AAPL", "MSFT"], { env: realEnv, provider: p });
  assert.deepEqual(out.map((q) => q.symbol), ["AAPL"]);
  await getQuotes(db, ["AAPL"], { env: realEnv, provider: p });
  assert.equal(calls, 1, "second call served from the 60s cache");
  await assert.rejects(() => getQuote(db, "MSFT", { env: realEnv, provider: p }), (e: unknown) => e instanceof MarketDataError && e.code === "NO_MARKET_DATA");
});

// ---------- 8. stored candles (backtests / signals) ----------------------------------

test("getStoredCandles reads only the active mode's rows, returns the LATEST window, and never needs an API key", async () => {
  const rows = [...history("AAPL", "simulated", 100), ...history("AAPL", "twelvedata", 500)];
  rows.push({ symbol: "AAPL", ts: "2026-09-26", open: 1, high: 2, low: 1, close: 1.5, volume: null, source: "twelvedata" } as Row);
  const { db } = fakeDb({ market_data: rows.filter((r, i, a) => a.findIndex((x) => x["ts"] === r["ts"] && x["source"] === r["source"]) === i) });
  const env = { MARKET_DATA_MODE: "real", MARKET_DATA_PROVIDER: "twelvedata" }; // note: no API key
  const latest = await getStoredCandles(db, "AAPL", { limit: 5 }, { env });
  assert.equal(latest.length, 5);
  assert.deepEqual(latest.map((c) => c.ts), [...latest.map((c) => c.ts)].sort(), "ascending order for the engine");
  assert.equal(latest.at(-1)!.ts, "2026-09-27", "the most recent candles, not the oldest");
  assert.ok(latest.every((c) => c.open > 400 || c.open === 1), "only provider rows");
  const sim = await getStoredCandles(db, "AAPL", { from: "2026-09-01", to: "2026-09-05" }, { env: { MARKET_DATA_MODE: "simulated" } });
  assert.equal(sim.length, 5);
  assert.ok(sim.every((c) => c.open < 200), "only simulated rows");
});

// ---------- 9. review fixes (added after auditing the Phase 2 implementation) ------------

test("403 (symbol not on the provider plan) is a per-symbol error; only 401 is a credential failure", async () => {
  const code = async (status: number) => {
    try { await provider(async () => jsonRes({ status: "error", code: status, message: "x" }, status)).getQuote("AAPL"); return "no error"; }
    catch (e) { return (e as MarketDataError).code; }
  };
  assert.equal(await code(403), "UNSUPPORTED_SYMBOL");
  assert.equal(await code(401), "PROVIDER_AUTH_FAILED");
});

test("runIngestion: a plan-limited symbol (403) does not stop the other symbols; a bad key (401) does", async () => {
  const run = async (failWith: number) => {
    const { db } = fakeDb();
    const seen: string[] = [];
    const tp = provider(async (url) => {
      const sym = new URL(url).searchParams.get("symbol")!;
      seen.push(sym);
      if (sym === "BTC/USD") return jsonRes({ status: "error", code: failWith, message: "x" }, failWith);
      return jsonRes({ status: "ok", values: [{ datetime: "2026-09-25", open: "1", high: "2", low: "1", close: "1.5", volume: "10" }] });
    });
    const summary = await runIngestion(db, tp, { symbols: ["BTC-USD", "AAPL", "MSFT"], now: new Date(`${TODAY}T12:00:00Z`), log: () => {} });
    return { seen, summary };
  };
  const plan = await run(403);
  assert.deepEqual(plan.seen, ["BTC/USD", "AAPL", "MSFT"], "kept going after the 403");
  assert.equal(plan.summary.aborted, undefined);
  assert.equal(plan.summary.results.filter((r) => !r.error).length, 2);
  assert.equal(plan.summary.ok, false, "but the run is still reported as not fully ok");
  const key = await run(401);
  assert.deepEqual(key.seen, ["BTC/USD"], "stopped after the credential failure");
  assert.match(key.summary.aborted ?? "", /PROVIDER_AUTH_FAILED/);
});

test("accountEquity: values holdings at current quotes; a held symbol with no quote is an error, never worth 0", async () => {
  resetQuoteCache();
  const { db } = fakeDb({ market_data: [...history("AAPL", "twelvedata", 200), ...history("MSFT", "twelvedata", 400)] });
  const both = stubProvider({ getQuotes: async (syms) => ({ quotes: syms.map((s) => goodQuote(s, s === "AAPL" ? 100 : 200)), failures: [] }) });
  const held = [{ symbol: "AAPL", quantity: "2" }, { symbol: "MSFT", quantity: 1 }];
  assert.equal(await accountEquity(db, 1000, held, { env: realEnv, provider: both }), 1000 + 2 * 100 + 200);

  resetQuoteCache();
  const partial = stubProvider({ getQuotes: async (syms) => ({ quotes: syms.filter((s) => s === "AAPL").map((s) => goodQuote(s, 100)), failures: syms.filter((s) => s !== "AAPL").map((symbol) => ({ symbol, error: new MarketDataError("PROVIDER_ERROR", "down") })) }) });
  await assert.rejects(() => accountEquity(db, 1000, held, { env: realEnv, provider: partial }), (e: unknown) => e instanceof MarketDataError && e.code === "NO_MARKET_DATA" && /MSFT/.test(e.message));

  const untouched = stubProvider({ getQuotes: async () => { throw new Error("no holdings, so no provider call"); } });
  assert.equal(await accountEquity(db, 1234, [], { env: realEnv, provider: untouched }), 1234);
});

// ======================================================================================
// Phase 2.5 verification tests. Still NO network: fake fetch / provider / database only.
// ======================================================================================

const okQuoteJson = (over: Record<string, unknown> = {}) => ({ symbol: "X", close: "100.5", previous_close: "99", timestamp: 1790586000, is_market_open: true, ...over });

test("symbol mapping: all 8 tradable symbols map to exactly one distinct Twelve Data symbol (GOLD -> XAU/USD) and requests use it", async () => {
  assert.deepEqual(Object.keys(TWELVE_DATA_SYMBOLS).sort(), [...SYMBOLS].sort(), "mapping covers exactly the app's symbols");
  assert.equal(new Set(Object.values(TWELVE_DATA_SYMBOLS)).size, SYMBOLS.length, "no two app symbols share a provider symbol");
  const expected: Record<string, string> = { "BTC-USD": "BTC/USD", "ETH-USD": "ETH/USD", AAPL: "AAPL", MSFT: "MSFT", NVDA: "NVDA", TSLA: "TSLA", "EUR-USD": "EUR/USD", GOLD: "XAU/USD" };
  assert.deepEqual({ ...TWELVE_DATA_SYMBOLS }, expected);
  const sent: string[] = [];
  const p = provider(async (url) => { sent.push(new URL(url).searchParams.get("symbol")!); return jsonRes(okQuoteJson()); });
  for (const sym of SYMBOLS) assert.equal((await p.getQuote(sym)).symbol, sym, "quote is returned under OUR symbol, not the provider's");
  assert.deepEqual(sent, SYMBOLS.map((x) => expected[x]));
  assert.ok(sent.every((x) => !x.includes("-")), "no app-style dashes leak to the provider");
});

test("an unsupported / plan-limited symbol is marked UNAVAILABLE, the rest of the list keeps working, and no synthetic price is substituted", async () => {
  resetQuoteCache();
  const { db } = fakeDb({ market_data: [...history("AAPL", "twelvedata", 200), ...history("GOLD", "twelvedata", 2000), ...history("GOLD", "simulated", 2050)] });
  const tp = provider(async (url) => {
    const sym = new URL(url).searchParams.get("symbol");
    return sym === "XAU/USD" ? jsonRes({ status: "error", code: 403, message: "plan" }, 403) : jsonRes(okQuoteJson({ close: "210" }));
  });
  const r = await getQuotesWithStatus(db, ["AAPL", "GOLD"], { env: realEnv, provider: tp });
  assert.deepEqual(r.quotes.map((q) => q.symbol), ["AAPL"]);
  assert.equal(r.quotes[0]!.price, 210);
  assert.equal(r.unavailable.length, 1);
  assert.equal(r.unavailable[0]!.symbol, "GOLD");
  assert.equal(r.unavailable[0]!.code, "UNSUPPORTED_SYMBOL");
  assert.ok(!/apikey|https?:\/\//i.test(r.unavailable[0]!.message));
  // getQuote for the unavailable symbol fails loudly (used by the order ticket / signals)
  await assert.rejects(() => getQuote(db, "GOLD", { env: realEnv, provider: tp }), (e: unknown) => e instanceof MarketDataError && e.code === "UNSUPPORTED_SYMBOL");
  // no stored real history for a symbol is also "unavailable", never quietly dropped or faked
  resetQuoteCache();
  const r2 = await getQuotesWithStatus(db, ["AAPL", "MSFT"], { env: realEnv, provider: tp });
  assert.deepEqual(r2.unavailable.map((u) => [u.symbol, u.code]), [["MSFT", "NO_MARKET_DATA"]]);
});

test("freshness: quote age is judged from the PROVIDER timestamp (also for cached quotes); closed markets are 'closed', not stale", async () => {
  const T0 = Date.parse("2026-09-28T09:00:00.000Z");
  const asOf = new Date(T0).toISOString();
  const { db } = fakeDb({ market_data: history("AAPL", "twelvedata", 200) });
  const cachedEnv = { ...realEnv, MARKET_DATA_QUOTE_TTL_SECONDS: "3600" };
  let calls = 0;
  const open = stubProvider({ getQuotes: async (syms) => { calls++; return { quotes: syms.map((s) => ({ symbol: s, price: 100, prevClose: 99, asOf, marketOpen: true })), failures: [] }; } });

  resetQuoteCache();
  const fresh = await getQuote(db, "AAPL", { env: cachedEnv, provider: open, now: () => T0 + 60_000 });
  assert.equal(fresh.asOf, asOf);
  assert.equal(fresh.stale, false);
  assert.equal(quoteFreshness(fresh), "fresh");

  const later = await getQuote(db, "AAPL", { env: cachedEnv, provider: open, now: () => T0 + QUOTE_STALE_AFTER_MS + 5 * 60_000 });
  assert.equal(calls, 1, "second read came from the cache");
  assert.equal(later.asOf, asOf, "cache never rewrites the timestamp to 'now'");
  assert.equal(later.stale, true, "same cached quote is now presented as delayed");
  assert.equal(quoteFreshness(later), "delayed");

  const closed = stubProvider({ getQuotes: async (syms) => ({ quotes: syms.map((s) => ({ symbol: s, price: 100, prevClose: 99, asOf, marketOpen: false })), failures: [] }) });
  resetQuoteCache();
  const q = await getQuote(db, "AAPL", { env: cachedEnv, provider: closed, now: () => T0 + 3 * 86_400_000 });
  assert.equal(q.stale, false, "a closed market's last price is not 'stale'");
  assert.equal(quoteFreshness(q), "closed");
  assert.equal(q.asOf, asOf);

  const sim = await getQuote(fakeDb({ market_data: history("AAPL", "simulated", 100) }).db, "AAPL", { env: { MARKET_DATA_MODE: "simulated" } });
  assert.deepEqual([sim.marketOpen, sim.stale], [null, false]);
});

test("adapter: is_market_open is parsed as true / false / null (unknown is never guessed); missing timestamp is rejected, not invented", async () => {
  const get = (over: Record<string, unknown>) => provider(async () => jsonRes(okQuoteJson(over))).getQuote("AAPL");
  assert.equal((await get({ is_market_open: true })).marketOpen, true);
  assert.equal((await get({ is_market_open: false })).marketOpen, false);
  assert.equal((await get({ is_market_open: undefined })).marketOpen, null);
  assert.equal((await get({ is_market_open: "maybe" })).marketOpen, null);
  await assert.rejects(() => get({ timestamp: undefined }), (e: unknown) => e instanceof MarketDataError && e.code === "PROVIDER_INVALID_RESPONSE");
});

test("adapter: a timeout that fires while the response BODY is streaming is reported as PROVIDER_TIMEOUT", async () => {
  const slowBody = async (_u: string, init?: RequestInit) => ({
    status: 200,
    json: () => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  }) as unknown as Response;
  await assert.rejects(() => provider(slowBody, 30).getQuote("AAPL"), (e: unknown) => e instanceof MarketDataError && e.code === "PROVIDER_TIMEOUT");
});

test("storage errors: raw database text is never forwarded; callers get a fixed MARKET_DATA_STORAGE_ERROR", async () => {
  const errDb = (() => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit"]) b[m] = () => b;
    b["then"] = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { code: "42703", message: "column market_data.source does not exist" } });
    return { from: () => b } as never;
  })();
  const check = (e: unknown) => {
    assert.ok(e instanceof MarketDataError && e.code === "MARKET_DATA_STORAGE_ERROR");
    assert.ok(!/market_data|column|source does not exist|42703/i.test(e.message), e.message);
    return true;
  };
  await assert.rejects(() => getQuotes(errDb, ["AAPL"], { env: realEnv, provider: stubProvider() }), check);
  await assert.rejects(() => getStoredCandles(errDb, "AAPL", {}, { env: realEnv }), check);
});

test("simulated mode still works end to end: every symbol with data is quoted and labelled simulated; a symbol without data is listed unavailable", async () => {
  const rows = ["BTC-USD", "AAPL"].flatMap((s) => history(s, "simulated", 100));
  const { db } = fakeDb({ market_data: [...rows, ...history("AAPL", "twelvedata", 900)] });
  const env = { MARKET_DATA_MODE: "simulated" };
  const r = await getQuotesWithStatus(db, ["BTC-USD", "AAPL", "MSFT"], { env });
  assert.deepEqual(r.quotes.map((q) => q.symbol), ["BTC-USD", "AAPL"]);
  assert.ok(r.quotes.every((q) => q.source === "simulated" && Number.isFinite(q.price) && q.price > 0 && q.price < 500), "simulated prices only; provider rows (900s) ignored");
  assert.deepEqual(r.unavailable.map((u) => [u.symbol, u.code]), [["MSFT", "NO_MARKET_DATA"]]);
  const st = currentMarketStatus(r.quotes, { env });
  assert.deepEqual([st.label, st.state, st.mode], ["SIMULATED MARKET DATA", "ok", "simulated"]);
  assert.ok((await getStoredCandles(db, "AAPL", { limit: 3 }, { env })).every((c) => c.open < 200));
});

test("real mode with missing/invalid configuration: explicit MARKET DATA UNAVAILABLE, no quote object, no synthetic price", async () => {
  const { db } = fakeDb({ market_data: [...history("AAPL", "simulated", 100), ...history("AAPL", "twelvedata", 200)] });
  for (const env of [{ MARKET_DATA_MODE: "real" }, { MARKET_DATA_MODE: "real", MARKET_DATA_PROVIDER: "twelvedata" }, { MARKET_DATA_MODE: "real", MARKET_DATA_PROVIDER: "bogus", MARKET_DATA_API_KEY: SECRET }]) {
    resetQuoteCache();
    let err: unknown;
    let out: unknown;
    try { out = await getQuotesWithStatus(db, ["AAPL"], { env }); } catch (e) { err = e; }
    assert.equal(out, undefined, "must not produce quotes");
    assert.ok(err instanceof MarketDataError);
    const status = unavailableStatus(err as MarketDataError, { env });
    assert.deepEqual([status.label, status.state], ["MARKET DATA UNAVAILABLE", "unavailable"]);
    assert.ok(!/live|real-time/i.test(status.detail) && !status.detail.includes(SECRET));
  }
  assert.equal(unavailableStatus(new MarketDataError("INVALID_CONFIG", "x"), { env: { MARKET_DATA_MODE: "bogus" } }).mode, "unknown", "an unparseable mode is reported as unknown, never guessed");
  assert.equal(unavailableStatus(new MarketDataError("PROVIDER_NOT_CONFIGURED", "x"), { env: { MARKET_DATA_MODE: "real" } }).mode, "real");
});

// ---------- ingestion endpoint: authentication, validation, status codes -----------------

const ingestReq = (body: unknown, auth?: string) => new Request("http://app.test/api/public/market-ingest", { method: "POST", headers: auth ? { authorization: auth } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });
const dayRow = (ts: string, c: number) => ({ ts, open: c, high: c + 1, low: c - 1, close: c, volume: 10 });

test("cron authentication (real cron-auth.ts): no header / wrong secret -> 401, secret not configured -> 500, valid current or previous secret passes; provider never called otherwise", async () => {
  const saved = { cur: process.env["LOVABLE_CRON_SECRET"], prev: process.env["LOVABLE_CRON_SECRET_PREVIOUS"] };
  let calls = 0;
  const spy = stubProvider({ getHistoricalCandles: async () => { calls++; return []; } });
  const { db } = fakeDb();
  const run = async (auth?: string) => (await handleIngestRequest(ingestReq({ symbols: ["AAPL"] }, auth), { provider: spy, db, log: () => {} })).status;
  try {
    delete process.env["LOVABLE_CRON_SECRET"]; delete process.env["LOVABLE_CRON_SECRET_PREVIOUS"];
    assert.equal(await run("Bearer anything"), 500, "no secret configured on the server");
    process.env["LOVABLE_CRON_SECRET"] = "test-only-current-secret";
    assert.equal(await run(), 401);
    assert.equal(await run("Bearer wrong-secret"), 401);
    assert.equal(await run("Basic dGVzdA=="), 401);
    assert.equal(await run("Bearer two words"), 401);
    assert.equal(calls, 0, "provider untouched by unauthenticated requests");
    assert.notEqual(await run("Bearer test-only-current-secret"), 401);
    process.env["LOVABLE_CRON_SECRET_PREVIOUS"] = "test-only-previous-secret";
    assert.notEqual(await run("Bearer test-only-previous-secret"), 401, "rotation: previous secret still accepted");
    assert.equal(await run("Bearer test-only-current-secretX"), 401);
  } finally {
    for (const [k, v] of [["LOVABLE_CRON_SECRET", saved.cur], ["LOVABLE_CRON_SECRET_PREVIOUS", saved.prev]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("ingest endpoint: malformed bodies are rejected with 400 before any provider call", async () => {
  let calls = 0;
  const spy = stubProvider({ getHistoricalCandles: async () => { calls++; return []; } });
  const { db } = fakeDb();
  const bad = ["not json", "[]", "null", '{"symbols":[]}', '{"symbols":["AAPL"],"extra":1}', '{"days":0}', '{"days":1001}', '{"days":1.5}', '{"days":"30"}', '{"symbols":[""]}'];
  for (const body of bad) {
    const res = await handleIngestRequest(ingestReq(body), { authenticate: async () => null, provider: spy, db });
    assert.equal(res.status, 400, body);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "INVALID_REQUEST");
  }
  assert.equal(calls, 0);
  assert.deepEqual(parseIngestBody(""), { ok: true, value: {} });
  assert.deepEqual(parseIngestBody('{"symbols":["AAPL"],"days":30}'), { ok: true, value: { symbols: ["AAPL"], days: 30 } });
});

test("ingest endpoint: provider not configured -> 503 naming variables only; body never contains a secret", async () => {
  for (const env of [{}, { MARKET_DATA_PROVIDER: "bogus", MARKET_DATA_API_KEY: SECRET }]) {
    const res = await handleIngestRequest(ingestReq({}), { authenticate: async () => null, env, db: fakeDb().db });
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.match(text, /PROVIDER_NOT_CONFIGURED|INVALID_CONFIG/);
    assert.ok(!text.includes(SECRET));
  }
});

test("ingest endpoint: one failing symbol does not corrupt or block the valid ones (partial success -> 502 with per-symbol results)", async () => {
  const { db, tables } = fakeDb();
  const p = stubProvider({
    getHistoricalCandles: async (symbol) => {
      if (symbol === "GOLD") throw new MarketDataError("UNSUPPORTED_SYMBOL", "GOLD is not available on the current plan.");
      return [dayRow("2026-09-24", 100), dayRow("2026-09-25", 101), { ...dayRow("2026-09-26", 102), high: 1 }].map((r) => ({ symbol, ...r, volume: r.volume }));
    },
  });
  const res = await handleIngestRequest(ingestReq({ symbols: ["AAPL", "GOLD", "MSFT"] }), { authenticate: async () => null, provider: p, db, now: new Date(`${TODAY}T12:00:00Z`), log: () => {} });
  assert.equal(res.status, 502);
  const body = (await res.json()) as { ok: boolean; aborted?: string; results: { symbol: string; upserted: number; rejected: number; error?: { code: string } }[] };
  assert.equal(body.ok, false);
  assert.equal(body.aborted, undefined, "a per-symbol failure does not abort the run");
  assert.deepEqual(body.results.map((r) => [r.symbol, r.error?.code ?? "ok", r.upserted, r.rejected]), [["AAPL", "ok", 2, 1], ["GOLD", "UNSUPPORTED_SYMBOL", 0, 0], ["MSFT", "ok", 2, 1]]);
  const stored = tables["market_data"]!;
  assert.deepEqual([...new Set(stored.map((r) => r["symbol"]))].sort(), ["AAPL", "MSFT"], "nothing stored for the failed symbol");
  assert.equal(stored.length, 4, "the malformed candle (high below open/close) was rejected, valid ones kept");
  assert.ok(stored.every((r) => r["source"] === "twelvedata"));
});

test("ingest endpoint: full success -> 200; provider-wide failure -> 502 with nothing written; responses never contain the API key", async () => {
  const good = stubProvider({ getHistoricalCandles: async (symbol) => [{ symbol, ...dayRow("2026-09-25", 100) }] });
  const a = fakeDb();
  const ok = await handleIngestRequest(ingestReq({ symbols: ["AAPL", "MSFT"] }), { authenticate: async () => null, provider: good, db: a.db, now: new Date(`${TODAY}T12:00:00Z`), log: () => {} });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { ok: boolean }).ok, true);

  const b = fakeDb();
  const down = provider(async () => { throw new Error(`connect ECONNREFUSED https://api.twelvedata.com/x?apikey=${SECRET}`); });
  const bad = await handleIngestRequest(ingestReq({ symbols: ["AAPL", "MSFT"] }), { authenticate: async () => null, provider: down, db: b.db, now: new Date(`${TODAY}T12:00:00Z`), log: () => {} });
  assert.equal(bad.status, 502);
  const text = await bad.text();
  assert.ok(!text.includes(SECRET) && !text.includes("apikey") && !text.includes("https://"));
  assert.equal((b.tables["market_data"] ?? []).length, 0);
});
