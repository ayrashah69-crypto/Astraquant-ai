// HTTP-level logic of the scheduled ingestion endpoint, kept out of the route file so its
// authentication, validation and status codes can be tested without the TanStack runtime.
// The route (src/routes/api/public/market-ingest.ts) only forwards the Request here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateCronRequest } from "../integrations/supabase/cron-auth.ts";
import { MarketDataError } from "./market-status.ts";
import type { Env } from "./market-config.server.ts";
import { createMarketProvider } from "./market-provider.server.ts";
import type { MarketDataProvider } from "./market-provider.server.ts";
import { runIngestion } from "./market-ingest.server.ts";
import type { IngestLog } from "./market-ingest.server.ts";

/** Test seam. In production every field is left unset. */
export type IngestRequestDeps = {
  env?: Env;
  provider?: MarketDataProvider;
  db?: SupabaseClient;
  now?: Date;
  log?: IngestLog;
  authenticate?: (request: Request) => Promise<Response | null>;
};

type Body = { symbols?: string[]; days?: number };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const BAD_BODY = { ok: false, error: { code: "INVALID_REQUEST", message: 'Body must be JSON like {"symbols": ["AAPL"], "days": 30}.' } };

// Same rules the previous zod schema enforced: only `symbols` (1-20 strings of 1-20 chars) and
// `days` (integer 1-1000) are allowed; unknown keys are rejected.
export function parseIngestBody(text: string): { ok: true; value: Body } | { ok: false } {
  if (!text.trim()) return { ok: true, value: {} };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false }; }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const rec = raw as Record<string, unknown>;
  if (Object.keys(rec).some((k) => k !== "symbols" && k !== "days")) return { ok: false };
  const value: Body = {};
  if (rec["symbols"] !== undefined) {
    const s = rec["symbols"];
    if (!Array.isArray(s) || s.length < 1 || s.length > 20 || s.some((x) => typeof x !== "string" || x.length < 1 || x.length > 20)) return { ok: false };
    value.symbols = s as string[];
  }
  if (rec["days"] !== undefined) {
    const d = rec["days"];
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 1000) return { ok: false };
    value.days = d;
  }
  return { ok: true, value };
}

export async function handleIngestRequest(request: Request, deps: IngestRequestDeps = {}): Promise<Response> {
  const denied = await (deps.authenticate ?? authenticateCronRequest)(request);
  if (denied) {
    console.warn("[market-ingest] rejected request: missing or invalid cron credentials", { status: denied.status });
    return denied;
  }

  const parsed = parseIngestBody(await request.text());
  if (!parsed.ok) return json(BAD_BODY, 400);
  const input = parsed.value;

  try {
    const provider = deps.provider ?? createMarketProvider(deps.env ?? process.env);
    const db = deps.db ?? (await import("../integrations/supabase/client.server.ts")).supabaseAdmin;
    const summary = await runIngestion(db, provider, {
      ...(input.symbols ? { symbols: input.symbols } : {}),
      ...(input.days ? { days: input.days } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    });
    return json(summary, summary.ok ? 200 : 502);
  } catch (e) {
    if (e instanceof MarketDataError) {
      console.error("[market-ingest] cannot run", { code: e.code });
      return json({ ok: false, error: { code: e.code, message: e.message } }, e.code === "PROVIDER_NOT_CONFIGURED" || e.code === "INVALID_CONFIG" ? 503 : 502);
    }
    console.error("[market-ingest] unexpected failure");
    return json({ ok: false, error: { code: "INGEST_FAILED", message: "Ingestion failed unexpectedly. See server logs." } }, 500);
  }
}
