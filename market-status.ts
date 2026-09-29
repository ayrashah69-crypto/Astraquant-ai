// Shared between server and browser: contains NO secrets and NO server-only imports.
// Defines the typed market-data error and the status/label shown in the UI so that
// simulated and real prices can never be presented under the same wording.

export type MarketMode = "real" | "simulated";

export type MarketErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "INVALID_CONFIG"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_ERROR"
  | "UNSUPPORTED_SYMBOL"
  | "NO_MARKET_DATA"
  | "MARKET_DATA_STORAGE_ERROR";

// Messages on this error are written by us and are safe to show to users: they never
// contain API keys, provider response bodies, request URLs or stack traces.
export class MarketDataError extends Error {
  code: MarketErrorCode;
  constructor(code: MarketErrorCode, message: string) {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
  }
}

export type MarketDataStatus = {
  mode: MarketMode | "unknown";
  state: "ok" | "unavailable";
  /** Short badge text. */
  label: string;
  /** One honest sentence about what the data is (and is not). */
  detail: string;
  provider: string | null;
  /** Timestamp of the newest provider quote seen, when known. */
  asOf: string | null;
  code?: MarketErrorCode;
};

export function describeMarketData(input: { mode: MarketMode; providerName: string | null; asOf?: string | null }): MarketDataStatus {
  if (input.mode === "simulated") {
    return {
      mode: "simulated",
      state: "ok",
      label: "SIMULATED MARKET DATA",
      detail: "Synthetic prices generated for demo and testing. They are not real market prices.",
      provider: null,
      asOf: null,
    };
  }
  const name = input.providerName ?? "the configured provider";
  // Deliberately no "live" / "real-time" wording: latency and coverage depend on the
  // provider's plan and on whether the underlying market is open.
  const when = input.asOf ? ` Latest quote timestamp: ${input.asOf}.` : "";
  return {
    mode: "real",
    state: "ok",
    label: "REAL MARKET DATA",
    detail: `Quotes and history from ${name}. Timing, delay and coverage depend on the provider plan and market hours.${when}`,
    provider: input.providerName,
    asOf: input.asOf ?? null,
  };
}

export function unavailableMarketData(err: { code: MarketErrorCode; message: string }, mode: MarketMode | "unknown" = "unknown"): MarketDataStatus {
  return {
    mode,
    state: "unavailable",
    label: "MARKET DATA UNAVAILABLE",
    detail: err.message,
    provider: null,
    asOf: null,
    code: err.code,
  };
}

/** A symbol that could not be quoted right now, with a user-safe reason. The rest of the list keeps working. */
export type QuoteUnavailable = { symbol: string; code: MarketErrorCode; message: string };

/**
 * A quote older than this, while its market is (or may be) open, is presented as DELAYED rather
 * than fresh. This is a display heuristic we chose, not a provider fact. It is compared against the
 * provider's own quote timestamp, never against when we fetched or cached the quote.
 */
export const QUOTE_STALE_AFTER_MS = 15 * 60 * 1000;

/** "closed" = the provider says the market is closed (last known price); "delayed" = old while open/unknown. */
export type QuoteFreshness = "fresh" | "delayed" | "closed";

export function quoteFreshness(q: { marketOpen: boolean | null; stale: boolean }): QuoteFreshness {
  if (q.marketOpen === false) return "closed";
  return q.stale ? "delayed" : "fresh";
}
