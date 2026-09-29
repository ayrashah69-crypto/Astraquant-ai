// Server-only market-data provider abstraction.
//
// Nothing outside src/lib/*.server.ts and the ingestion route may import this file, so the
// provider API key can never reach a client bundle. Downstream code (market.server.ts,
// trading.functions.ts, engine.ts) only ever sees the internal Quote / Candle shapes.
import { MarketDataError } from "./market-status.ts";
import { getProviderConfig } from "./market-config.server.ts";
import type { Env } from "./market-config.server.ts";

/** market_data.ts is a DATE column, so only daily bars can be stored today. */
export type CandleInterval = "1day";

export type ProviderQuote = {
  symbol: string;
  price: number;
  /** Provider-reported previous close; null when the provider does not supply it. */
  prevClose: number | null;
  /** Timestamp of the quote as reported BY THE PROVIDER (not the time we fetched it). */
  asOf: string;
  /** Provider-reported market state (Twelve Data `is_market_open`); null when not supplied. */
  marketOpen: boolean | null;
};

/** Candle as parsed from a provider. NOT yet validated: unparseable numbers are NaN and a
 *  missing volume is null. Validation/rejection happens in market-ingest.server.ts. */
export type RawCandle = {
  symbol: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type QuoteBatch = { quotes: ProviderQuote[]; failures: { symbol: string; error: MarketDataError }[] };

export interface MarketDataProvider {
  /** Stable id, stored in market_data.source for rows this provider supplied. */
  readonly id: string;
  readonly displayName: string;
  getQuote(symbol: string): Promise<ProviderQuote>;
  /** Per-symbol failures are reported, not thrown, so one bad symbol does not hide the rest. */
  getQuotes(symbols: readonly string[]): Promise<QuoteBatch>;
  getHistoricalCandles(symbol: string, startDate: string, endDate: string, interval?: CandleInterval): Promise<RawCandle[]>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const PROVIDER_NAMES: Readonly<Record<string, string>> = { twelvedata: "Twelve Data" };
export function getProviderDisplayName(id: string): string {
  return PROVIDER_NAMES[id] ?? id;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return NaN;
  return Number(v);
}

function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null; // unknown stays unknown; we never guess a market state
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------------------
// Twelve Data adapter. Written against Twelve Data's documented REST shapes
// (/quote and /time_series). NOT verified against the live API in this repo's environment.
// Symbol coverage and real-time vs delayed data depend on your Twelve Data plan.
// ---------------------------------------------------------------------------------------
const TWELVE_DATA_BASE = "https://api.twelvedata.com";

export const TWELVE_DATA_SYMBOLS: Readonly<Record<string, string>> = {
  "BTC-USD": "BTC/USD",
  "ETH-USD": "ETH/USD",
  AAPL: "AAPL",
  MSFT: "MSFT",
  NVDA: "NVDA",
  TSLA: "TSLA",
  "EUR-USD": "EUR/USD",
  GOLD: "XAU/USD",
};

export class TwelveDataProvider implements MarketDataProvider {
  readonly id = "twelvedata";
  readonly displayName = "Twelve Data";
  private apiKey: string;
  private timeoutMs: number;
  private fetchImpl: FetchLike;

  constructor(opts: { apiKey: string; timeoutMs?: number; fetchImpl?: FetchLike }) {
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private providerSymbol(symbol: string): string {
    const mapped = Object.hasOwn(TWELVE_DATA_SYMBOLS, symbol) ? TWELVE_DATA_SYMBOLS[symbol] : undefined;
    if (!mapped) throw new MarketDataError("UNSUPPORTED_SYMBOL", `Symbol ${symbol} is not supported by the ${this.displayName} adapter.`);
    return mapped;
  }

  // All failures are converted to MarketDataError with OUR wording. We never forward the
  // provider's message, the request URL (it carries the key) or the underlying exception.
  private async request(path: string, params: Record<string, string>, symbol: string): Promise<Record<string, unknown>> {
    const url = new URL(TWELVE_DATA_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("apikey", this.apiKey);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let status = 0;
    let body: unknown;
    try {
      const res = await this.fetchImpl(url.toString(), { signal: ctrl.signal, headers: { Accept: "application/json" } });
      status = res.status;
      try { body = await res.json(); } catch (e) {
        // A timeout that fires while the body is still streaming is a timeout, not a "bad payload".
        if (ctrl.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
        body = undefined;
      }
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        throw new MarketDataError("PROVIDER_TIMEOUT", `${this.displayName} did not respond within ${Math.round(this.timeoutMs / 1000)}s.`);
      }
      throw new MarketDataError("PROVIDER_ERROR", `Could not reach ${this.displayName}.`);
    } finally {
      clearTimeout(timer);
    }

    const rec = asRecord(body);
    const apiCode = rec && rec["status"] === "error" ? Number(rec["code"]) : NaN;
    const code = Number.isFinite(apiCode) ? apiCode : status;

    if (code === 401) {
      throw new MarketDataError("PROVIDER_AUTH_FAILED", `${this.displayName} rejected the API key.`);
    }
    // 403 = the key is valid but the plan does not cover this instrument. That is specific to the
    // symbol, so it must not be reported as a credential failure (which aborts a whole ingestion run).
    if (code === 403) {
      throw new MarketDataError("UNSUPPORTED_SYMBOL", `${symbol} is not available on the current ${this.displayName} plan.`);
    }
    if (code === 429) {
      throw new MarketDataError("PROVIDER_RATE_LIMITED", `${this.displayName} rate limit reached. Try again shortly.`);
    }
    if (code === 404) {
      throw new MarketDataError("NO_MARKET_DATA", `${this.displayName} has no data for ${symbol} for this request.`);
    }
    if (code === 400) {
      throw new MarketDataError("UNSUPPORTED_SYMBOL", `${this.displayName} rejected ${symbol} (unsupported symbol or parameters).`);
    }
    if (code >= 500) {
      throw new MarketDataError("PROVIDER_ERROR", `${this.displayName} reported a server error.`);
    }
    if (status !== 200 || !rec || rec["status"] === "error") {
      throw new MarketDataError("PROVIDER_INVALID_RESPONSE", `${this.displayName} returned an unexpected response.`);
    }
    return rec;
  }

  async getQuote(symbol: string): Promise<ProviderQuote> {
    const rec = await this.request("/quote", { symbol: this.providerSymbol(symbol) }, symbol);
    const price = toNumber(rec["close"]);
    const prev = toNumber(rec["previous_close"]);
    const epoch = toNumber(rec["timestamp"]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(epoch) || epoch <= 0) {
      throw new MarketDataError("PROVIDER_INVALID_RESPONSE", `${this.displayName} returned an incomplete quote for ${symbol}.`);
    }
    return {
      symbol,
      price,
      prevClose: Number.isFinite(prev) && prev > 0 ? prev : null,
      asOf: new Date(epoch * 1000).toISOString(),
      marketOpen: parseBool(rec["is_market_open"]),
    };
  }

  async getQuotes(symbols: readonly string[]): Promise<QuoteBatch> {
    const settled = await Promise.all(
      symbols.map(async (symbol) => {
        try { return { quote: await this.getQuote(symbol) }; }
        catch (e) {
          const error = e instanceof MarketDataError ? e : new MarketDataError("PROVIDER_ERROR", `Could not fetch a quote for ${symbol}.`);
          return { failure: { symbol, error } };
        }
      }),
    );
    const quotes: ProviderQuote[] = [];
    const failures: QuoteBatch["failures"] = [];
    for (const s of settled) {
      if ("quote" in s && s.quote) quotes.push(s.quote);
      else if ("failure" in s && s.failure) failures.push(s.failure);
    }
    return { quotes, failures };
  }

  async getHistoricalCandles(symbol: string, startDate: string, endDate: string, interval: CandleInterval = "1day"): Promise<RawCandle[]> {
    if (interval !== "1day") throw new MarketDataError("INVALID_CONFIG", "Only 1day candles can be stored (market_data.ts is a date column).");
    const rec = await this.request(
      "/time_series",
      { symbol: this.providerSymbol(symbol), interval: "1day", start_date: startDate, end_date: endDate, order: "ASC", outputsize: "5000" },
      symbol,
    );
    const values = rec["values"];
    if (!Array.isArray(values)) {
      throw new MarketDataError("PROVIDER_INVALID_RESPONSE", `${this.displayName} returned no candle list for ${symbol}.`);
    }
    return values.map((v): RawCandle => {
      const r = asRecord(v) ?? {};
      let ts = String(r["datetime"] ?? "").trim();
      if (ts.length > 10 && /^\d{4}-\d{2}-\d{2}[ T]/.test(ts)) ts = ts.slice(0, 10);
      const rawVol = r["volume"];
      return {
        symbol,
        ts,
        open: toNumber(r["open"]),
        high: toNumber(r["high"]),
        low: toNumber(r["low"]),
        close: toNumber(r["close"]),
        // A missing volume stays null (e.g. FX). We never substitute 0 for "unknown".
        volume: rawVol === undefined || rawVol === null || rawVol === "" ? null : toNumber(rawVol),
      };
    });
  }
}

type ProviderFactory = (cfg: { apiKey: string; timeoutMs: number }, fetchImpl?: FetchLike) => MarketDataProvider;
const REGISTRY = new Map<string, ProviderFactory>([
  ["twelvedata", (cfg, fetchImpl) => new TwelveDataProvider({ ...cfg, ...(fetchImpl ? { fetchImpl } : {}) })],
]);

/** Builds the configured provider, or throws a clear, secret-free MarketDataError. */
export function createMarketProvider(env: Env = process.env, fetchImpl?: FetchLike): MarketDataProvider {
  const cfg = getProviderConfig(env);
  const factory = REGISTRY.get(cfg.providerId);
  if (!factory) throw new MarketDataError("INVALID_CONFIG", "Unsupported MARKET_DATA_PROVIDER.");
  return factory({ apiKey: cfg.apiKey, timeoutMs: cfg.timeoutMs }, fetchImpl);
}
