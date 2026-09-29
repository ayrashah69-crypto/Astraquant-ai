import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle } from "./engine.ts";
import { MarketDataError, QUOTE_STALE_AFTER_MS, describeMarketData, unavailableMarketData } from "./market-status.ts";
import type { MarketDataStatus, MarketMode, QuoteUnavailable } from "./market-status.ts";
import { getMarketDataMode, getProviderId, getQuoteTtlMs } from "./market-config.server.ts";
import type { Env } from "./market-config.server.ts";
import { createMarketProvider, getProviderDisplayName } from "./market-provider.server.ts";
import type { MarketDataProvider, ProviderQuote, QuoteBatch } from "./market-provider.server.ts";

import { SYMBOLS } from "./symbols.ts";
export { SYMBOLS };

/** market_data.source value of the synthetic demo rows. Provider rows use the provider id. */
export const SIMULATED_SOURCE = "simulated";

// Same shape as before plus `source`, which says whether this price is real or synthetic.
// `asOf` is the PROVIDER's quote timestamp in real mode (never fetch/cache time). `marketOpen` is the
// provider-reported state (null = unknown / simulated). `stale` = old while the market is open or unknown.
export type Quote = { symbol: string; price: number; prevClose: number; changePct: number; volatility: number; asOf: string; source: MarketMode; marketOpen: boolean | null; stale: boolean };

/** Test seam: everything defaults to process.env and the configured provider. */
export type MarketDeps = { env?: Env; provider?: MarketDataProvider; now?: () => number };

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (Math.abs(h) % 1000) / 159; }

// Simulated intraday quote: deterministic oscillation around the latest stored daily close,
// scaled by that symbol's recent volatility. Moves every minute. NOT a real exchange feed.
// Only used when MARKET_DATA_MODE=simulated — never as a fallback for a failing provider.
export function simulatedPrice(symbol: string, lastClose: number, vol: number, now = Date.now()) {
  const t = now / 60000, h = hash(symbol);
  const wave = (Math.sin(t / 37 + h) + 0.5 * Math.sin(t / 11 + 2 * h) + 0.3 * Math.sin(t / 3.7 + 3 * h)) / 1.8;
  return lastClose * (1 + vol * 0.8 * wave);
}

// Which market_data rows belong to the active mode. Needs only the provider ID (no API key),
// so stored history / backtests keep working even if the quote endpoint is unreachable.
function activeSource(deps: MarketDeps = {}): { mode: MarketMode; sourceId: string } {
  const env = deps.env ?? process.env;
  const mode = getMarketDataMode(env);
  if (mode === "simulated") return { mode, sourceId: SIMULATED_SOURCE };
  return { mode, sourceId: deps.provider?.id ?? getProviderId(env) };
}

// Raw PostgREST/Postgres messages can name tables and columns, so they are logged server-side
// (code only) and replaced with a fixed user-safe message. Typical cause after a deploy: the
// market_data provenance migration has not been applied yet.
function storageError(err: { code?: string }): MarketDataError {
  console.error("[market-data] reading stored market data failed", { dbCode: err.code ?? "unknown" });
  return new MarketDataError("MARKET_DATA_STORAGE_ERROR", "Stored market data could not be read. Check that all database migrations are applied.");
}

function realizedVol(closes: number[]) {
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]!));
  const m = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length));
}

async function recentCloses(db: SupabaseClient, symbols: readonly string[], sourceId: string) {
  const since = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await db.from("market_data").select("symbol, ts, close").eq("source", sourceId).in("symbol", symbols as string[]).gte("ts", since).order("ts", { ascending: true });
  if (error) throw storageError(error);
  const by: Record<string, { ts: string; close: number }[]> = {};
  for (const r of data ?? []) (by[r.symbol] ??= []).push({ ts: r.ts, close: Number(r.close) });
  return by;
}

// ---- provider quote cache -----------------------------------------------------------
// Short in-process cache + in-flight de-duplication so dashboards, risk checks and the
// public landing page do not each hit the provider (and its rate limit). This only reuses a
// REAL quote for at most MARKET_DATA_QUOTE_TTL_SECONDS; it is never a synthetic fallback.
const quoteCache = new Map<string, { quote: ProviderQuote; fetchedAt: number }>();
const inflight = new Map<string, Promise<QuoteBatch>>();
export function resetQuoteCache() { quoteCache.clear(); inflight.clear(); }

async function providerQuotes(provider: MarketDataProvider, symbols: readonly string[], ttlMs: number, nowMs: number): Promise<QuoteBatch> {
  const fresh: ProviderQuote[] = [];
  const missing: string[] = [];
  for (const s of symbols) {
    const hit = quoteCache.get(`${provider.id}:${s}`);
    if (hit && ttlMs > 0 && nowMs - hit.fetchedAt < ttlMs) fresh.push(hit.quote);
    else missing.push(s);
  }
  if (!missing.length) return { quotes: fresh, failures: [] };
  const key = `${provider.id}:${[...missing].sort().join(",")}`;
  let p = inflight.get(key);
  if (!p) {
    p = provider.getQuotes(missing).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  const batch = await p;
  for (const q of batch.quotes) quoteCache.set(`${provider.id}:${q.symbol}`, { quote: q, fetchedAt: nowMs });
  return { quotes: [...fresh, ...batch.quotes], failures: batch.failures };
}

type Resolved = { quotes: Quote[]; failures: { symbol: string; error: MarketDataError }[] };

async function simulatedQuotes(db: SupabaseClient, symbols: readonly string[]): Promise<Resolved> {
  const by = await recentCloses(db, symbols, SIMULATED_SOURCE);
  const failures: Resolved["failures"] = symbols.filter((s) => !by[s]?.length).map((symbol) => ({ symbol, error: new MarketDataError("NO_MARKET_DATA", `No simulated data stored for ${symbol}.`) }));
  const quotes = symbols.filter((s) => by[s]?.length).map((s): Quote => {
    const rows = by[s]!.slice(-21);
    const vol = realizedVol(rows.map((r) => r.close));
    const last = rows.at(-1)!;
    const price = simulatedPrice(s, last.close, vol);
    return { symbol: s, price, prevClose: last.close, changePct: (price / last.close - 1) * 100, volatility: vol, asOf: new Date().toISOString(), source: "simulated", marketOpen: null, stale: false };
  });
  return { quotes, failures };
}

async function realQuotes(db: SupabaseClient, symbols: readonly string[], deps: MarketDeps): Promise<Resolved> {
  const env = deps.env ?? process.env;
  const provider = deps.provider ?? createMarketProvider(env); // throws PROVIDER_NOT_CONFIGURED, never falls back
  const nowMs = deps.now?.() ?? Date.now();
  const failures: Resolved["failures"] = [];
  const by = await recentCloses(db, symbols, provider.id);

  // Volatility comes from STORED REAL candles. Without history we say so instead of guessing.
  const wanted: string[] = [];
  for (const s of symbols) {
    if ((by[s]?.length ?? 0) < 2) {
      failures.push({ symbol: s, error: new MarketDataError("NO_MARKET_DATA", `No stored ${provider.displayName} candles for ${s}. Run market-data ingestion first.`) });
    } else wanted.push(s);
  }
  if (!wanted.length) return { quotes: [], failures };

  let batch: QuoteBatch;
  try {
    batch = await providerQuotes(provider, wanted, getQuoteTtlMs(env), nowMs);
  } catch (e) {
    throw e instanceof MarketDataError ? e : new MarketDataError("PROVIDER_ERROR", `Could not fetch quotes from ${provider.displayName}.`);
  }
  failures.push(...batch.failures);

  const quotes: Quote[] = [];
  for (const s of wanted) {
    const pq = batch.quotes.find((q) => q.symbol === s);
    if (!pq) continue;
    const rows = by[s]!.slice(-21);
    const lastClose = rows.at(-1)!.close;
    const prevClose = pq.prevClose ?? lastClose; // last stored completed daily close, real data
    // Freshness is judged from the provider's own timestamp at read time, so a quote served from the
    // cache ages honestly. A closed market is "closed" (last known price), not "stale".
    const ageMs = nowMs - Date.parse(pq.asOf);
    const stale = pq.marketOpen !== false && Number.isFinite(ageMs) && ageMs > QUOTE_STALE_AFTER_MS;
    quotes.push({ symbol: s, price: pq.price, prevClose, changePct: (pq.price / prevClose - 1) * 100, volatility: realizedVol(rows.map((r) => r.close)), asOf: pq.asOf, source: "real", marketOpen: pq.marketOpen, stale });
  }
  return { quotes, failures };
}

async function resolveQuotes(db: SupabaseClient, symbols: readonly string[], deps: MarketDeps): Promise<Resolved> {
  const { mode } = activeSource(deps);
  if (!symbols.length) return { quotes: [], failures: [] };
  return mode === "simulated" ? simulatedQuotes(db, symbols) : realQuotes(db, symbols, deps);
}

/**
 * Same as getQuotes() but never hides a symbol: every requested symbol is either in `quotes` or in
 * `unavailable` with a user-safe reason, so one unsupported/failed symbol (e.g. GOLD on a plan that
 * lacks it) leaves the rest of the list working AND visibly marked. Configuration / provider-wide
 * failures (not configured, timeout, storage error) still THROW as MarketDataError.
 */
export async function getQuotesWithStatus(db: SupabaseClient, symbols: readonly string[] = SYMBOLS, deps: MarketDeps = {}): Promise<{ quotes: Quote[]; unavailable: QuoteUnavailable[] }> {
  const { quotes, failures } = await resolveQuotes(db, symbols, deps);
  const seen = new Set<string>();
  const unavailable: QuoteUnavailable[] = [];
  for (const f of failures) {
    if (seen.has(f.symbol)) continue;
    seen.add(f.symbol);
    unavailable.push({ symbol: f.symbol, code: f.error.code, message: f.error.message });
  }
  return { quotes, unavailable };
}

/**
 * Quotes for the requested symbols. In real mode a provider/config failure THROWS a
 * MarketDataError — there is no silent fall back to synthetic prices. Symbols that
 * individually fail are omitted; if none succeed the first failure is thrown.
 */
export async function getQuotes(db: SupabaseClient, symbols: readonly string[] = SYMBOLS, deps: MarketDeps = {}): Promise<Quote[]> {
  const { quotes, failures } = await resolveQuotes(db, symbols, deps);
  if (!quotes.length && failures.length) throw failures[0]!.error;
  return quotes;
}

export async function getQuote(db: SupabaseClient, symbol: string, deps: MarketDeps = {}): Promise<Quote> {
  const { quotes, failures } = await resolveQuotes(db, [symbol], deps);
  if (quotes[0]) return quotes[0];
  throw failures[0]?.error ?? new MarketDataError("UNSUPPORTED_SYMBOL", `Unknown symbol ${symbol}`);
}

/**
 * Values the account at current quotes for the symbols actually held. A held symbol with no
 * quote is an ERROR, never "worth 0": getQuotes() omits symbols whose quote failed, and treating
 * them as zero would silently understate equity and distort position sizing.
 */
export async function accountEquity(db: SupabaseClient, cash: number, held: readonly { symbol: string; quantity: unknown }[], deps: MarketDeps = {}): Promise<number> {
  const symbols = [...new Set(held.map((p) => p.symbol))];
  if (!symbols.length) return cash;
  const qs = await getQuotes(db, symbols, deps);
  let total = cash;
  for (const p of held) {
    const q = qs.find((x) => x.symbol === p.symbol);
    if (!q) throw new MarketDataError("NO_MARKET_DATA", `No current quote for held position ${p.symbol}, so the account cannot be valued right now.`);
    total += +(p.quantity as number) * q.price;
  }
  return total;
}

/**
 * Stored daily candles for the ACTIVE mode only (simulated rows in simulated mode, the
 * provider's rows in real mode). Used by signals, charts and backtests — none of which call
 * a quote endpoint. With no date range it returns the most recent `limit` candles (the old
 * ascending+limit query would have silently returned the OLDEST rows once history grew).
 * A stored NULL volume is exposed as 0 only to keep the engine's Candle shape; the engine
 * does not use volume.
 */
export async function getStoredCandles(db: SupabaseClient, symbol: string, opts: { from?: string; to?: string; limit?: number } = {}, deps: MarketDeps = {}): Promise<Candle[]> {
  const { sourceId } = activeSource(deps);
  const limit = opts.limit ?? 1000;
  const ranged = Boolean(opts.from || opts.to);
  let q = db.from("market_data").select("ts, open, high, low, close, volume").eq("symbol", symbol).eq("source", sourceId);
  if (opts.from) q = q.gte("ts", opts.from);
  if (opts.to) q = q.lte("ts", opts.to);
  const { data, error } = await q.order("ts", { ascending: ranged }).limit(limit);
  if (error) throw storageError(error);
  const rows = ranged ? (data ?? []) : [...(data ?? [])].reverse();
  return rows.map((r) => ({ ts: r.ts, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: r.volume === null || r.volume === undefined ? 0 : +r.volume }));
}

/** Data-source id to persist alongside results computed from stored candles (e.g. backtests). */
export function activeDataSource(deps: MarketDeps = {}): string {
  return activeSource(deps).sourceId;
}

/** Configuration-derived status for the UI/labels (no network call). */
export function currentMarketStatus(quotes: readonly Quote[] = [], deps: MarketDeps = {}): MarketDataStatus {
  try {
    const { mode, sourceId } = activeSource(deps);
    if (mode === "simulated") return describeMarketData({ mode, providerName: null });
    const asOf = quotes.map((q) => q.asOf).sort().at(-1) ?? null;
    return describeMarketData({ mode, providerName: getProviderDisplayName(sourceId), asOf });
  } catch (e) {
    if (e instanceof MarketDataError) return unavailableMarketData(e);
    throw e;
  }
}

/** Status to show when fetching quotes failed with a MarketDataError. */
export function unavailableStatus(err: MarketDataError, deps: MarketDeps = {}): MarketDataStatus {
  let mode: MarketMode | "unknown" = "unknown";
  try { mode = getMarketDataMode(deps.env ?? process.env); } catch { /* invalid config stays "unknown" */ }
  return unavailableMarketData(err, mode);
}

export async function getActiveLicense(db: SupabaseClient, userId: string) {
  const { data } = await db.from("licenses").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  const now = Date.now();
  for (const l of data ?? []) {
    if (l.status === "active" && new Date(l.expires_at).getTime() < now) {
      await db.from("licenses").update({ status: "expired" }).eq("id", l.id);
      l.status = "expired";
    }
  }
  const active = (data ?? []).find((l) => l.status === "active") ?? null;
  return { active, all: data ?? [] };
}
