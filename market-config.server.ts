// Server-only configuration for the market-data layer.
//
// Conventions follow the rest of the project (see client.server.ts): configuration is
// read from server environment variables via bracket access, never from VITE_* / public
// variables, and never from the database. Error messages name the VARIABLE that is
// missing, never its value.
import { MarketDataError } from "./market-status.ts";
import type { MarketMode } from "./market-status.ts";

export type Env = Record<string, string | undefined>;

/** Provider ids this build knows how to talk to. Kept here (not in the provider module)
 *  so reading stored data never requires constructing a provider or having an API key. */
export const SUPPORTED_PROVIDERS = ["twelvedata"] as const;

/**
 * MARKET_DATA_MODE = "real" | "simulated".
 * Unset defaults to "real" on purpose: a deployment must opt IN to synthetic prices, so
 * simulated data can never be served just because someone forgot to configure a provider.
 */
export function getMarketDataMode(env: Env = process.env): MarketMode {
  const raw = env["MARKET_DATA_MODE"]?.trim().toLowerCase();
  if (!raw) return "real";
  if (raw === "real" || raw === "simulated") return raw;
  throw new MarketDataError("INVALID_CONFIG", 'MARKET_DATA_MODE must be either "real" or "simulated".');
}

/** Provider id only (no secret). Enough to know which stored rows belong to the provider. */
export function getProviderId(env: Env = process.env): string {
  const id = env["MARKET_DATA_PROVIDER"]?.trim().toLowerCase();
  if (!id) {
    throw new MarketDataError("PROVIDER_NOT_CONFIGURED", "Market data provider is not configured. Set MARKET_DATA_PROVIDER (and MARKET_DATA_API_KEY) on the server, or set MARKET_DATA_MODE=simulated for demo data.");
  }
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(id)) {
    throw new MarketDataError("INVALID_CONFIG", `Unsupported MARKET_DATA_PROVIDER. Supported: ${SUPPORTED_PROVIDERS.join(", ")}.`);
  }
  return id;
}

export type ProviderConfig = { providerId: string; apiKey: string; timeoutMs: number };

export function getProviderConfig(env: Env = process.env): ProviderConfig {
  const providerId = getProviderId(env);
  const apiKey = env["MARKET_DATA_API_KEY"]?.trim();
  if (!apiKey) {
    throw new MarketDataError("PROVIDER_NOT_CONFIGURED", "Market data API key is not configured. Set MARKET_DATA_API_KEY on the server.");
  }
  const t = Number(env["MARKET_DATA_TIMEOUT_MS"]);
  const timeoutMs = Number.isFinite(t) && t > 0 ? Math.min(30_000, Math.max(1_000, t)) : 8_000;
  return { providerId, apiKey, timeoutMs };
}

/** How long a provider quote may be reused across requests (protects provider rate limits). */
export function getQuoteTtlMs(env: Env = process.env): number {
  const raw = env["MARKET_DATA_QUOTE_TTL_SECONDS"];
  if (raw === undefined || raw.trim() === "") return 60_000;
  const s = Number(raw);
  if (!Number.isFinite(s) || s < 0) return 60_000;
  return Math.min(3600, s) * 1000;
}
