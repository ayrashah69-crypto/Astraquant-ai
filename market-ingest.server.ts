// Server-only historical ingestion: provider -> validate -> normalize -> upsert -> market_data.
//
// Ingestion knows nothing about paper trading. It only writes rows tagged with the
// provider's id in market_data.source, so provider data and the synthetic demo rows
// (source = 'simulated') can coexist and are never mixed when read back.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MarketDataError } from "./market-status.ts";
import type { MarketDataProvider, RawCandle } from "./market-provider.server.ts";
import { SYMBOLS } from "./market.server.ts";

export type CandleRow = {
  symbol: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: string;
};

export type RejectReason =
  | "symbol_mismatch"
  | "invalid_timestamp"
  | "incomplete_or_future"
  | "invalid_price"
  | "ohlc_inconsistent"
  | "invalid_volume";

export function isValidDateString(ts: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ts)) return false;
  const [y, m, d] = ts.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const toDateString = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(date: string, n: number): string {
  return toDateString(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
}

/**
 * Validates one provider candle. `today` is the current UTC date (YYYY-MM-DD): candles dated
 * today or later are treated as incomplete/future and are never stored, so a half-formed
 * daily bar can't be mistaken for a finished one. Nothing is repaired or invented.
 */
export function validateCandle(c: RawCandle, ctx: { symbol: string; today: string }): { ok: true } | { ok: false; reason: RejectReason } {
  if (c.symbol !== ctx.symbol) return { ok: false, reason: "symbol_mismatch" };
  if (typeof c.ts !== "string" || !isValidDateString(c.ts)) return { ok: false, reason: "invalid_timestamp" };
  if (c.ts >= ctx.today) return { ok: false, reason: "incomplete_or_future" };
  for (const v of [c.open, c.high, c.low, c.close]) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return { ok: false, reason: "invalid_price" };
  }
  if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) {
    return { ok: false, reason: "ohlc_inconsistent" };
  }
  if (c.volume !== null && (typeof c.volume !== "number" || !Number.isFinite(c.volume) || c.volume < 0)) {
    return { ok: false, reason: "invalid_volume" };
  }
  return { ok: true };
}

export type NormalizeResult = {
  rows: CandleRow[];
  rejected: number;
  rejectedByReason: Partial<Record<RejectReason, number>>;
  skippedIncomplete: number;
  /** Extra copies of a date within one response; the last copy wins. */
  duplicates: number;
};

export function normalizeCandles(raw: readonly RawCandle[], opts: { symbol: string; source: string; today: string }): NormalizeResult {
  const byTs = new Map<string, CandleRow>();
  const rejectedByReason: NormalizeResult["rejectedByReason"] = {};
  let rejected = 0, skippedIncomplete = 0, duplicates = 0;
  for (const c of raw) {
    const v = validateCandle(c, opts);
    if (!v.ok) {
      if (v.reason === "incomplete_or_future") { skippedIncomplete++; continue; }
      rejected++;
      rejectedByReason[v.reason] = (rejectedByReason[v.reason] ?? 0) + 1;
      continue;
    }
    if (byTs.has(c.ts)) duplicates++; // Postgres would refuse two rows for one key in a single upsert
    byTs.set(c.ts, { symbol: c.symbol, ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, source: opts.source });
  }
  const rows = [...byTs.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { rows, rejected, rejectedByReason, skippedIncomplete, duplicates };
}

export type SymbolIngestResult = {
  symbol: string;
  range: { start: string; end: string };
  fetched: number;
  upserted: number;
  rejected: number;
  rejectedByReason: NormalizeResult["rejectedByReason"];
  skippedIncomplete: number;
  duplicates: number;
  error?: { code: string; message: string };
};

export type IngestLog = (message: string, meta?: Record<string, unknown>) => void;
const defaultLog: IngestLog = (m, meta) => console.info(`[market-ingest] ${m}`, meta ?? "");

const UPSERT_CHUNK = 500;

export async function ingestSymbol(
  db: SupabaseClient,
  provider: MarketDataProvider,
  symbol: string,
  range: { start: string; end: string },
  now: Date = new Date(),
): Promise<SymbolIngestResult> {
  const raw = await provider.getHistoricalCandles(symbol, range.start, range.end, "1day");
  const n = normalizeCandles(raw, { symbol, source: provider.id, today: toDateString(now) });
  let upserted = 0;
  for (let i = 0; i < n.rows.length; i += UPSERT_CHUNK) {
    const chunk = n.rows.slice(i, i + UPSERT_CHUNK);
    // The primary key is (symbol, ts, source): re-running ingestion updates rows in place.
    const { error } = await db.from("market_data").upsert(chunk, { onConflict: "symbol,ts,source" });
    if (error) {
      console.error("[market-ingest] database write failed", { symbol, dbCode: error.code });
      throw new Error("Database write failed while storing market data.");
    }
    upserted += chunk.length;
  }
  return { symbol, range, fetched: raw.length, upserted, rejected: n.rejected, rejectedByReason: n.rejectedByReason, skippedIncomplete: n.skippedIncomplete, duplicates: n.duplicates };
}

export type IngestOptions = {
  symbols?: readonly string[];
  /** Explicit look-back window. Otherwise: incremental from the newest stored candle, or a backfill. */
  days?: number;
  backfillDays?: number;
  overlapDays?: number;
  now?: Date;
  log?: IngestLog;
};

export type IngestSummary = {
  provider: string;
  ok: boolean;
  aborted?: string;
  results: SymbolIngestResult[];
};

// These failures affect every symbol, so continuing would only burn quota / spam logs.
const ABORT_CODES = new Set(["PROVIDER_RATE_LIMITED", "PROVIDER_AUTH_FAILED", "PROVIDER_NOT_CONFIGURED"]);

async function latestStoredDate(db: SupabaseClient, symbol: string, source: string): Promise<string | null> {
  const { data, error } = await db.from("market_data").select("ts").eq("symbol", symbol).eq("source", source).order("ts", { ascending: false }).limit(1);
  if (error) throw new Error("Database read failed while checking stored market data.");
  return data?.[0]?.ts ?? null;
}

export async function runIngestion(db: SupabaseClient, provider: MarketDataProvider, opts: IngestOptions = {}): Promise<IngestSummary> {
  const log = opts.log ?? defaultLog;
  const now = opts.now ?? new Date();
  const today = toDateString(now);
  const symbols = opts.symbols ?? SYMBOLS;
  const results: SymbolIngestResult[] = [];
  let aborted: string | undefined;

  for (const symbol of symbols) {
    if (!(SYMBOLS as readonly string[]).includes(symbol)) {
      results.push({ symbol, range: { start: today, end: today }, fetched: 0, upserted: 0, rejected: 0, rejectedByReason: {}, skippedIncomplete: 0, duplicates: 0, error: { code: "UNSUPPORTED_SYMBOL", message: `Unknown symbol ${symbol}.` } });
      continue;
    }
    let start: string;
    try {
      if (opts.days) start = addDays(today, -opts.days);
      else {
        const latest = await latestStoredDate(db, symbol, provider.id);
        start = latest ? addDays(latest, -(opts.overlapDays ?? 3)) : addDays(today, -(opts.backfillDays ?? 500));
      }
      const r = await ingestSymbol(db, provider, symbol, { start, end: today }, now);
      results.push(r);
      log(`ingested ${symbol}`, { provider: provider.id, fetched: r.fetched, upserted: r.upserted, rejected: r.rejected, duplicates: r.duplicates, skippedIncomplete: r.skippedIncomplete });
    } catch (e) {
      const code = e instanceof MarketDataError ? e.code : "INGEST_FAILED";
      const message = e instanceof MarketDataError ? e.message : "Ingestion failed for this symbol.";
      results.push({ symbol, range: { start: today, end: today }, fetched: 0, upserted: 0, rejected: 0, rejectedByReason: {}, skippedIncomplete: 0, duplicates: 0, error: { code, message } });
      log(`failed ${symbol}`, { provider: provider.id, code });
      if (ABORT_CODES.has(code)) { aborted = `${code}: stopped remaining symbols`; break; }
    }
  }
  return { provider: provider.id, ok: results.every((r) => !r.error) && !aborted, ...(aborted ? { aborted } : {}), results };
}
