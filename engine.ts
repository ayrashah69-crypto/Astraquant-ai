// AstraQuant analysis engine — pure, deterministic, runs server-side.
// Pipeline: Market Data -> Features -> Strategy -> BUY/SELL/HOLD + Confidence -> Risk Check.
// Nothing here guarantees profit; outputs are statistical heuristics on historical data.

export type Candle = { ts: string; open: number; high: number; low: number; close: number; volume: number };
export type Action = "BUY" | "SELL" | "HOLD";
export type StrategyId = "ema_cross" | "rsi_reversion" | "momentum_breakout" | "ensemble";

export const STRATEGIES: { id: StrategyId; name: string; description: string }[] = [
  { id: "ema_cross", name: "EMA Trend Cross", description: "Fast EMA(12) vs slow EMA(26) trend-following crossover." },
  { id: "rsi_reversion", name: "RSI Mean Reversion", description: "Buys oversold (RSI<30), exits overbought (RSI>70)." },
  { id: "momentum_breakout", name: "Momentum Breakout", description: "Enters on 20-day high breakouts, exits on 10-day low." },
  { id: "ensemble", name: "Ensemble Vote", description: "Majority vote across the three strategies, weighted by agreement." },
];

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1]! * (1 - k)));
  return out;
}

export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(50);
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= period) { gain += g / period; loss += l / period; }
    else { gain = (gain * (period - 1) + g) / period; loss = (loss * (period - 1) + l) / period; }
    if (i >= period) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export type Features = {
  close: number; emaFast: number; emaSlow: number; rsi: number;
  high20: number; low10: number; volatility: number; momentum10: number;
};

export function computeFeatures(candles: Candle[]): Features[] {
  const closes = candles.map((c) => c.close);
  const f = ema(closes, 12), s = ema(closes, 26), r = rsi(closes, 14);
  return candles.map((c, i) => {
    const w20 = candles.slice(Math.max(0, i - 20), i);
    const w10 = candles.slice(Math.max(0, i - 10), i);
    const rets = candles.slice(Math.max(1, i - 19), i + 1).map((x, j, arr) => {
      const prev = j === 0 ? candles[Math.max(0, i - 20)]!.close : arr[j - 1]!.close;
      return Math.log(x.close / prev);
    });
    const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
    const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length));
    return {
      close: c.close, emaFast: f[i]!, emaSlow: s[i]!, rsi: r[i]!,
      high20: w20.length ? Math.max(...w20.map((x) => x.high)) : c.high,
      low10: w10.length ? Math.min(...w10.map((x) => x.low)) : c.low,
      volatility: vol,
      momentum10: i >= 10 ? c.close / candles[i - 10]!.close - 1 : 0,
    };
  });
}

function single(id: Exclude<StrategyId, "ensemble">, cur: Features, prev: Features): { action: Action; strength: number } {
  if (id === "ema_cross") {
    const spread = (cur.emaFast - cur.emaSlow) / cur.emaSlow;
    if (prev.emaFast <= prev.emaSlow && cur.emaFast > cur.emaSlow) return { action: "BUY", strength: 0.6 + Math.min(0.3, Math.abs(spread) * 20) };
    if (prev.emaFast >= prev.emaSlow && cur.emaFast < cur.emaSlow) return { action: "SELL", strength: 0.6 + Math.min(0.3, Math.abs(spread) * 20) };
    return { action: "HOLD", strength: 0.3 + Math.min(0.3, Math.abs(spread) * 10) };
  }
  if (id === "rsi_reversion") {
    if (cur.rsi < 30) return { action: "BUY", strength: 0.5 + (30 - cur.rsi) / 60 };
    if (cur.rsi > 70) return { action: "SELL", strength: 0.5 + (cur.rsi - 70) / 60 };
    return { action: "HOLD", strength: 0.4 };
  }
  if (cur.close > cur.high20) return { action: "BUY", strength: 0.55 + Math.min(0.35, cur.momentum10 * 3) };
  if (cur.close < cur.low10) return { action: "SELL", strength: 0.55 + Math.min(0.35, Math.abs(cur.momentum10) * 3) };
  return { action: "HOLD", strength: 0.35 };
}

export function decide(strategy: StrategyId, cur: Features, prev: Features): { action: Action; confidence: number; votes?: Record<string, Action> } {
  if (strategy !== "ensemble") {
    const r = single(strategy, cur, prev);
    return { action: r.action, confidence: Math.round(Math.min(0.95, r.strength) * 100) / 100 };
  }
  const ids = ["ema_cross", "rsi_reversion", "momentum_breakout"] as const;
  const votes: Record<string, Action> = {};
  const tally: Record<Action, number> = { BUY: 0, SELL: 0, HOLD: 0 };
  for (const id of ids) { const r = single(id, cur, prev); votes[id] = r.action; tally[r.action] += r.strength; }
  // Trend-state tiebreaker so the ensemble also reacts outside crossover days
  const trend: Action = cur.emaFast > cur.emaSlow && cur.rsi < 65 ? "BUY" : cur.emaFast < cur.emaSlow && cur.rsi > 35 ? "SELL" : "HOLD";
  tally[trend] += 0.25;
  const action = (Object.keys(tally) as Action[]).sort((a, b) => tally[b] - tally[a])[0]!;
  const total = tally.BUY + tally.SELL + tally.HOLD;
  return { action, confidence: Math.round(Math.max(0.3, Math.min(0.9, tally[action] / total)) * 100) / 100, votes };
}

export type RiskCheck = { passed: boolean; reasons: string[]; suggestedQty: number; stopLoss: number; riskLevel: "LOW" | "MEDIUM" | "HIGH" };

export function riskCheck(opts: {
  action: Action; confidence: number; price: number; volatility: number;
  equity: number; cash: number; riskPerTradePct: number; maxPositionPct: number; currentQty: number;
}): RiskCheck {
  const reasons: string[] = [];
  const dailyVol = Math.max(opts.volatility, 0.002);
  const stopDistance = opts.price * dailyVol * 2;
  const riskLevel = dailyVol > 0.03 ? "HIGH" : dailyVol > 0.015 ? "MEDIUM" : "LOW";
  let qty = 0;
  if (opts.action === "BUY") {
    const riskBudget = opts.equity * (opts.riskPerTradePct / 100);
    const maxNotional = Math.min(opts.equity * (opts.maxPositionPct / 100) - opts.currentQty * opts.price, opts.cash);
    qty = Math.max(0, Math.min(riskBudget / stopDistance, maxNotional / opts.price));
    if (opts.confidence < 0.55) reasons.push("Confidence below 55% threshold");
    if (maxNotional <= 0) reasons.push("Position size limit or cash exhausted");
  } else if (opts.action === "SELL") {
    qty = opts.currentQty;
    if (qty <= 0) reasons.push("No open position to sell (short selling disabled)");
  } else reasons.push("HOLD — no trade proposed");
  if (riskLevel === "HIGH" && opts.confidence < 0.7) reasons.push("High volatility requires ≥70% confidence");
  qty = opts.price > 100 ? Math.floor(qty * 10000) / 10000 : Math.floor(qty * 100) / 100;
  if (qty <= 0 && reasons.length === 0) reasons.push("Computed size rounds to zero");
  return {
    passed: reasons.length === 0, reasons, suggestedQty: qty,
    stopLoss: opts.action === "BUY" ? opts.price - stopDistance : opts.price + stopDistance, riskLevel,
  };
}

export type BacktestResult = {
  finalEquity: number; totalReturnPct: number; maxDrawdownPct: number; winRate: number;
  totalTrades: number; wins: number; losses: number; buyHoldReturnPct: number;
  equityCurve: { ts: string; equity: number; drawdown: number; benchmark: number }[];
  trades: { ts: string; side: "BUY" | "SELL"; price: number; qty: number; pnl?: number }[];
};

// Long-only, next-bar-open execution, 0.1% fee per side, no leverage. SIMULATED.
export function backtest(candles: Candle[], strategy: StrategyId, capital: number, feeRate = 0.001): BacktestResult {
  const feats = computeFeatures(candles);
  let cash = capital, qty = 0, entry = 0, peak = capital, maxDd = 0, wins = 0, losses = 0;
  const curve: BacktestResult["equityCurve"] = [];
  const trades: BacktestResult["trades"] = [];
  let pending: Action | null = null;
  const first = candles[0]?.close ?? 1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (pending === "BUY" && qty === 0) {
      qty = (cash * (1 - feeRate)) / c.open; entry = c.open; cash = 0;
      trades.push({ ts: c.ts, side: "BUY", price: c.open, qty });
    } else if (pending === "SELL" && qty > 0) {
      const proceeds = qty * c.open * (1 - feeRate);
      const pnl = proceeds - qty * entry;
      pnl > 0 ? wins++ : losses++;
      trades.push({ ts: c.ts, side: "SELL", price: c.open, qty, pnl });
      cash = proceeds; qty = 0;
    }
    pending = null;
    if (i >= 26) { const d = decide(strategy, feats[i]!, feats[i - 1]!); if (d.action !== "HOLD") pending = d.action; }
    const equity = cash + qty * c.close;
    peak = Math.max(peak, equity);
    const dd = (peak - equity) / peak;
    maxDd = Math.max(maxDd, dd);
    curve.push({ ts: c.ts, equity: Math.round(equity * 100) / 100, drawdown: -Math.round(dd * 10000) / 100, benchmark: Math.round((capital * c.close) / first * 100) / 100 });
  }
  const finalEquity = curve.at(-1)?.equity ?? capital;
  const closed = wins + losses;
  return {
    finalEquity, totalReturnPct: (finalEquity / capital - 1) * 100, maxDrawdownPct: maxDd * 100,
    winRate: closed ? (wins / closed) * 100 : 0, totalTrades: trades.length, wins, losses,
    buyHoldReturnPct: ((candles.at(-1)?.close ?? first) / first - 1) * 100,
    equityCurve: curve, trades,
  };
}
