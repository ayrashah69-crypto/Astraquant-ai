import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { backtest, computeFeatures, decide, riskCheck, STRATEGIES, type Candle, type StrategyId } from "./engine";
import { accountEquity, activeDataSource, currentMarketStatus, getActiveLicense, getQuote, getQuotesWithStatus, getStoredCandles, unavailableStatus, type Quote } from "./market.server";
import { SYMBOLS } from "./symbols";
import { MarketDataError, type MarketDataStatus, type QuoteUnavailable } from "./market-status";
import { PaperBroker, TradeError, DEFAULT_FEE_RATE } from "./execution.server";

const symbolSchema = z.enum(SYMBOLS);
const strategySchema = z.enum(["ema_cross", "rsi_reversion", "momentum_breakout", "ensemble"]);
const paperTradeInput = z.object({
  symbol: symbolSchema,
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive().max(1e9),
  signalId: z.string().uuid().optional(),
});

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function publicClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

// Reads STORED daily candles for the active market-data mode (simulated rows vs the provider's
// rows). Never calls a quote endpoint, so backtests and charts work from history alone.
async function loadCandles(db: ReturnType<typeof publicClient>, symbol: string, from?: string, to?: string): Promise<Candle[]> {
  return getStoredCandles(db, symbol, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
}

async function requireLicense(userId: string) {
  const { active } = await getActiveLicense(await admin(), userId);
  if (!active) throw new TradeError("LICENSE_REQUIRED", "No active license. Visit License to activate one.");
  return active;
}

// Shared risk assessment for both executePaperTrade() and previewPaperTrade().
// Mirrors the market-data/feature loading generateSignal() already does, then runs
// the same engine.ts riskCheck() used for AI signals — so manual orders and preview
// requests are evaluated against identical risk-per-trade %, max-position % and
// volatility rules, without duplicating any of that logic.
async function assessTradeRisk(db: Awaited<ReturnType<typeof admin>>, userId: string, symbol: string, side: "BUY" | "SELL") {
  const candles = await loadCandles(db as never, symbol);
  if (candles.length < 2) throw new TradeError("MARKET_DATA_UNAVAILABLE", "Not enough market data available for this symbol");
  const quote = await getQuote(db, symbol);
  const last = candles.at(-1)!;
  const withLive: Candle[] = [
    ...candles,
    { ...last, ts: "live", open: last.close, close: quote.price, high: Math.max(last.close, quote.price), low: Math.min(last.close, quote.price) },
  ];
  const cur = computeFeatures(withLive).at(-1)!;

  const [{ data: pf }, { data: pos }, { data: profile }, { data: allPos }] = await Promise.all([
    db.from("portfolios").select("*").eq("user_id", userId).single(),
    db.from("positions").select("quantity").eq("user_id", userId).eq("symbol", symbol).maybeSingle(),
    db.from("profiles").select("*").eq("id", userId).single(),
    db.from("positions").select("symbol, quantity").eq("user_id", userId),
  ]);
  if (!pf) throw new TradeError("PORTFOLIO_NOT_FOUND", "Portfolio not found");

  const equity = await accountEquity(db, +pf.cash_balance, allPos ?? []);
  const currentQty = pos ? +pos.quantity : 0;

  // Manual/preview requests carry no model confidence. Treating them as fully
  // deliberate (confidence = 1) disables riskCheck()'s confidence-based gates — which
  // exist to filter uncertain AI signals, not explicit user intent — while still fully
  // applying the account's actual risk-per-trade %, max-position % and cash/position
  // checks. See the suggestedQty comparison at the call sites below for how the
  // account's size limits are actually enforced for manual BUYs.
  const risk = riskCheck({
    action: side,
    confidence: 1,
    price: quote.price,
    volatility: cur.volatility,
    equity,
    cash: +pf.cash_balance,
    riskPerTradePct: +(profile?.risk_per_trade ?? 2),
    maxPositionPct: +(profile?.max_position_pct ?? 25),
    currentQty,
  });

  return { risk, quote, equity, currentQty };
}

// Small tolerance so float rounding between signal-generation time and execution time
// (or between preview and submit) never causes a spurious rejection right at the edge
// of the account's own computed limit.
function withinSizeLimit(quantity: number, suggestedQty: number) {
  return quantity <= suggestedQty * 1.005 + 1e-8;
}

// ---------- Public ----------
export const getPublicMarkets = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { quotes, unavailable } = await getQuotesWithStatus(publicClient());
    // Every symbol is either quoted or listed in `unavailable`; if NONE could be quoted the whole
    // feed is reported as unavailable. Never replaced by synthetic prices.
    const first = unavailable[0];
    const marketData = quotes.length || !first
      ? currentMarketStatus(quotes)
      : unavailableStatus(new MarketDataError(first.code, first.message));
    return { quotes, unavailable, simulated: marketData.mode === "simulated", marketData };
  } catch (e) {
    if (!(e instanceof MarketDataError)) throw e;
    const none: Quote[] = [];
    const noneUnavailable: QuoteUnavailable[] = [];
    return { quotes: none, unavailable: noneUnavailable, simulated: false, marketData: unavailableStatus(e) };
  }
});

const btInput = z.object({
  symbol: symbolSchema, strategy: strategySchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capital: z.number().min(100).max(100_000_000),
});

export const runPublicBacktest = createServerFn({ method: "POST" })
  .inputValidator((d) => btInput.parse(d))
  .handler(async ({ data }) => {
    const candles = await loadCandles(publicClient(), data.symbol, data.startDate, data.endDate);
    if (candles.length < 40) throw new Error("Select a range with at least 40 trading days of data.");
    const r = backtest(candles, data.strategy, data.capital);
    return { ...r, trades: r.trades.slice(-50), label: "BACKTESTED — SIMULATED RESULTS" as const, marketData: currentMarketStatus() };
  });

// ---------- Authenticated ----------
export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const uid = context.userId;
    const [{ data: pf }, { data: positions }, { data: trades }, { data: signals }, { data: profile }] = await Promise.all([
      db.from("portfolios").select("*").eq("user_id", uid).maybeSingle(),
      db.from("positions").select("*").eq("user_id", uid),
      db.from("trades").select("*").eq("user_id", uid).order("executed_at", { ascending: false }).limit(200),
      db.from("ai_signals").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
      db.from("profiles").select("*").eq("id", uid).maybeSingle(),
    ]);
    if (!pf) throw new Error("Portfolio not initialised");
    // If market data is unavailable the dashboard still loads, with an explicit status. Positions
    // then fall back to cost basis (as they already did for a missing quote) and the UI says so.
    let quotes: Quote[] = [];
    let unavailable: QuoteUnavailable[] = [];
    let marketData: MarketDataStatus;
    try {
      ({ quotes, unavailable } = await getQuotesWithStatus(db));
      const first = unavailable[0];
      marketData = quotes.length || !first
        ? currentMarketStatus(quotes)
        : unavailableStatus(new MarketDataError(first.code, first.message));
    } catch (e) {
      if (!(e instanceof MarketDataError)) throw e;
      marketData = unavailableStatus(e);
    }
    // A held symbol with no quote is valued at cost below. Say so instead of leaving a healthy label.
    const unquoted = [...new Set((positions ?? []).map((p) => p.symbol))].filter((sym) => !quotes.some((q) => q.symbol === sym));
    if (unquoted.length && marketData.state === "ok") {
      marketData = unavailableStatus(new MarketDataError("NO_MARKET_DATA", `No current quote for ${unquoted.join(", ")}.`));
    }
    const pos = (positions ?? []).map((p) => {
      const q = quotes.find((x) => x.symbol === p.symbol);
      const price = q?.price ?? +p.avg_price;
      const value = price * +p.quantity;
      return { ...p, quantity: +p.quantity, avg_price: +p.avg_price, price, value, unrealized: (price - +p.avg_price) * +p.quantity, volatility: q?.volatility ?? 0 };
    });
    const invested = pos.reduce((a, p) => a + p.value, 0);
    const cash = +pf.cash_balance;
    const equity = cash + invested;
    const unrealized = pos.reduce((a, p) => a + p.unrealized, 0);
    const start = +pf.starting_balance;
    const largest = pos.reduce((m, p) => Math.max(m, p.value / Math.max(equity, 1)), 0);
    const weightedVol = invested ? pos.reduce((a, p) => a + p.volatility * p.value, 0) / invested : 0;
    const maxPct = +(profile?.max_position_pct ?? 25);
    const alerts: string[] = [];
    if (largest * 100 > maxPct) alerts.push(`Largest position ${(largest * 100).toFixed(1)}% exceeds ${maxPct}% limit`);
    if (equity < start * 0.9) alerts.push("Account drawdown exceeds 10% of starting balance");
    if (weightedVol > 0.03) alerts.push("Portfolio volatility is elevated");
    const history = [...(trades ?? [])].reverse().filter((t) => t.equity_after != null).map((t) => ({ ts: t.executed_at, equity: Number(t.equity_after) }));
    const { active, all } = await getActiveLicense(await admin(), uid);
    return {
      portfolio: { cash, equity, invested, start, realized: +pf.realized_pnl, unrealized, totalPnl: equity - start, totalPnlPct: (equity / start - 1) * 100 },
      positions: pos, trades: trades ?? [], signals: signals ?? [], quotes, unavailable, marketData, profile,
      risk: { exposurePct: equity ? (invested / equity) * 100 : 0, largestPct: largest * 100, weightedVol, alerts, status: alerts.length === 0 ? "NORMAL" : alerts.length === 1 ? "CAUTION" : "ELEVATED" },
      history: [{ ts: pf.created_at, equity: start }, ...history, { ts: new Date().toISOString(), equity }],
      license: active, licenses: all,
    };
  });

export const getCandles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ symbol: symbolSchema, days: z.number().int().min(30).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const all = await loadCandles(context.supabase as never, data.symbol);
    const feats = computeFeatures(all);
    return all.slice(-data.days).map((c, i, arr) => {
      const f = feats[all.length - arr.length + i]!;
      return { ...c, emaFast: f.emaFast, emaSlow: f.emaSlow, rsi: f.rsi };
    });
  });

export const generateSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ symbol: symbolSchema, strategy: strategySchema }).parse(d))
  .handler(async ({ data, context }) => {
    await requireLicense(context.userId);
    const db = context.supabase;
    const candles = await loadCandles(db as never, data.symbol);
    if (candles.length < 30) throw new MarketDataError("NO_MARKET_DATA", `Not enough stored candles for ${data.symbol} to analyse (need at least 30).`);
    const quote = await getQuote(db, data.symbol);
    // Append the current quote as the latest bar
    const last = candles.at(-1)!;
    candles.push({ ...last, ts: "live", open: last.close, close: quote.price, high: Math.max(last.close, quote.price), low: Math.min(last.close, quote.price) });
    const feats = computeFeatures(candles);
    const cur = feats.at(-1)!, prev = feats.at(-2)!;
    const d = decide(data.strategy as StrategyId, cur, prev);
    const [{ data: pf }, { data: pos }, { data: profile }, { data: allPos }] = await Promise.all([
      db.from("portfolios").select("*").eq("user_id", context.userId).single(),
      db.from("positions").select("quantity").eq("user_id", context.userId).eq("symbol", data.symbol).maybeSingle(),
      db.from("profiles").select("*").eq("id", context.userId).single(),
      db.from("positions").select("symbol, quantity").eq("user_id", context.userId),
    ]);
    const equity = await accountEquity(db, +pf!.cash_balance, allPos ?? []);
    const risk = riskCheck({
      action: d.action, confidence: d.confidence, price: quote.price, volatility: cur.volatility,
      equity, cash: +pf!.cash_balance, riskPerTradePct: +(profile?.risk_per_trade ?? 2), maxPositionPct: +(profile?.max_position_pct ?? 25),
      currentQty: pos ? +pos.quantity : 0,
    });
    const stratName = STRATEGIES.find((s) => s.id === data.strategy)!.name;
    const rationale = `${stratName}: EMA12 ${cur.emaFast > cur.emaSlow ? "above" : "below"} EMA26, RSI ${cur.rsi.toFixed(1)}, 10-bar momentum ${(cur.momentum10 * 100).toFixed(2)}%, daily vol ${(cur.volatility * 100).toFixed(2)}%.`;
    const features = { rsi: cur.rsi, emaFast: cur.emaFast, emaSlow: cur.emaSlow, momentum10: cur.momentum10, volatility: cur.volatility, high20: cur.high20, low10: cur.low10, votes: d.votes ?? null };
    const { data: row, error } = await (await admin()).from("ai_signals").insert({
      user_id: context.userId, symbol: data.symbol, strategy: data.strategy, action: d.action, confidence: d.confidence,
      price: quote.price, features, risk_check: risk, rationale,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

// Returns whether a candidate paper order would currently pass the account's risk
// rules, without executing anything. Used by the TradeTicket UI to show a risk status
// before the user submits — executePaperTrade() re-runs this same check server-side
// regardless of what the preview said, so nothing here is trusted as authorization.
export const previewPaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => paperTradeInput.omit({ signalId: true }).parse(d))
  .handler(async ({ data, context }) => {
    await requireLicense(context.userId);
    const db = await admin();
    const { risk, quote, currentQty } = await assessTradeRisk(db, context.userId, data.symbol, data.side);
    const oversizedBuy = data.side === "BUY" && !withinSizeLimit(data.quantity, risk.suggestedQty);
    const reasons = [...risk.reasons];
    if (oversizedBuy) reasons.push(`Requested quantity exceeds your risk-based limit of ~${risk.suggestedQty.toFixed(6)} units (risk-per-trade / max-position settings)`);
    const notional = quote.price * data.quantity;
    return {
      allowed: risk.passed && !oversizedBuy,
      reasons,
      riskLevel: risk.riskLevel,
      stopLoss: risk.stopLoss,
      suggestedQty: risk.suggestedQty,
      currentQty,
      estimatedPrice: quote.price,
      estimatedNotional: notional,
      estimatedFee: notional * DEFAULT_FEE_RATE,
    };
  });

export const executePaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => paperTradeInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireLicense(context.userId);
    const db = await admin();
    let source = "manual";
    if (data.signalId) {
      const { data: s } = await db.from("ai_signals").select("user_id").eq("id", data.signalId).maybeSingle();
      if (!s || s.user_id !== context.userId) throw new TradeError("SIGNAL_NOT_FOUND", "Signal not found");
      source = "ai_signal";
    }

    // Server-side risk enforcement for every paper trade, not just AI-signal-sourced
    // ones — previously a manual order via the Order Ticket bypassed riskCheck()
    // entirely. Reuses the exact same engine.ts riskCheck() generateSignal() uses.
    const { risk } = await assessTradeRisk(db, context.userId, data.symbol, data.side);
    if (!risk.passed) throw new TradeError("RISK_LIMIT_EXCEEDED", risk.reasons.join("; ") || "Trade blocked by risk rules");
    // Manual BUYs are additionally capped at the account's own risk-per-trade / max-
    // position derived size (the same suggestedQty a signal would carry). Signal-
    // sourced trades already carry a quantity set from this exact number at signal
    // generation time, so this only constrains freshly-entered manual orders.
    if (source === "manual" && data.side === "BUY" && !withinSizeLimit(data.quantity, risk.suggestedQty)) {
      throw new TradeError(
        "RISK_LIMIT_EXCEEDED",
        `Requested quantity ${data.quantity} exceeds your risk-based limit of ~${risk.suggestedQty.toFixed(6)} units. Reduce the quantity or adjust your risk settings.`,
      );
    }

    const broker = new PaperBroker(db);
    try {
      return await broker.submit({ userId: context.userId, symbol: data.symbol, side: data.side, quantity: data.quantity, source, signalId: data.signalId ?? null });
    } catch (e) {
      if (e instanceof TradeError) throw e;
      throw new Error(e instanceof Error ? e.message : "Trade failed");
    }
  });

export const resetPortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ startingBalance: z.number().min(1000).max(10_000_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: pf } = await db.from("portfolios").select("id").eq("user_id", context.userId).single();
    await db.from("positions").delete().eq("portfolio_id", pf!.id);
    await db.from("trades").delete().eq("portfolio_id", pf!.id);
    await db.from("portfolios").update({ starting_balance: data.startingBalance, cash_balance: data.startingBalance, realized_pnl: 0, created_at: new Date().toISOString() }).eq("id", pf!.id);
    return { ok: true };
  });

export const runBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => btInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireLicense(context.userId);
    const candles = await loadCandles(context.supabase as never, data.symbol, data.startDate, data.endDate);
    if (candles.length < 40) throw new Error("Select a range with at least 40 trading days of data.");
    const r = backtest(candles, data.strategy, data.capital);
    const { data: row, error } = await (await admin()).from("backtest_runs").insert({
      user_id: context.userId, symbol: data.symbol, strategy: data.strategy, start_date: data.startDate, end_date: data.endDate,
      starting_capital: data.capital, data_source: activeDataSource(), final_equity: r.finalEquity, total_return_pct: r.totalReturnPct, max_drawdown_pct: r.maxDrawdownPct,
      win_rate: r.winRate, total_trades: r.totalTrades, wins: r.wins, losses: r.losses, equity_curve: r.equityCurve,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id, ...r, trades: r.trades.slice(-50), marketData: currentMarketStatus() };
  });

export const listBacktests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("backtest_runs")
      .select("id, symbol, strategy, start_date, end_date, starting_capital, final_equity, total_return_pct, max_drawdown_pct, win_rate, total_trades, data_source, created_at")
      .order("created_at", { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const verifyLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ licenseKey: z.string().trim().regex(/^AQ-(DEMO|PRO|ENTERPRISE)-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/, "Invalid key format") }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await getActiveLicense(db, context.userId); // refresh expiries
    const { data: l } = await db.from("licenses").select("*").eq("license_key", data.licenseKey).maybeSingle();
    if (!l || l.user_id !== context.userId) return { valid: false, reason: "License not found for this account" };
    if (l.status !== "active") return { valid: false, reason: `License is ${l.status}`, plan: l.plan, expires_at: l.expires_at };
    return { valid: true, plan: l.plan, expires_at: l.expires_at, status: l.status };
  });

export const renewDemoLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { active, all } = await getActiveLicense(db, context.userId);
    if (active) throw new Error("You already have an active license.");
    if (all.filter((l) => l.plan === "demo").length >= 3) throw new Error("Demo renewal limit reached.");
    const { data: key, error: ke } = await db.rpc("generate_license_key", { _plan: "demo" });
    if (ke) throw new Error(ke.message);
    const { data, error } = await db.from("licenses").insert({ license_key: key as string, user_id: context.userId, plan: "demo", expires_at: new Date(Date.now() + 14 * 86400000).toISOString() }).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ display_name: z.string().trim().min(1).max(60), risk_per_trade: z.number().min(0.1).max(10), max_position_pct: z.number().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").update({ ...data, updated_at: new Date().toISOString() }).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
