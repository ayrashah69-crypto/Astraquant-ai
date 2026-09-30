// Focused unit tests for the pure risk/decision logic in engine.ts.
//
// Run with: node --experimental-strip-types --test src/lib/engine.test.ts
// (also wired up as `npm test`). Uses only Node's built-in test runner and
// assert module — no framework/dependency install required, consistent with
// Phase 1's "don't add a huge testing framework" constraint.
//
// Scope: riskCheck() is the function newly enforced on manual paper trades in
// this phase (src/lib/trading.functions.ts: assessTradeRisk()). These tests
// cover the scenarios that matter for that enforcement: a valid trade sized
// within budget, a trade rejected for exceeding the cash/position budget, and
// a sell rejected for an insufficient position. They do not exercise the
// database layer (execute_paper_trade's row-locking) — that requires a live
// Postgres instance, which is not available in this environment; that part
// is verified by code review of the migration SQL instead (see AGENTS.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { riskCheck } from "./engine.ts";

const base = {
  price: 100,
  volatility: 0.01, // 1% daily vol -> LOW risk band
  equity: 100_000,
  cash: 100_000,
  riskPerTradePct: 2,
  maxPositionPct: 25,
  currentQty: 0,
};

test("riskCheck: valid BUY within budget passes and sizes a positive quantity", () => {
  const r = riskCheck({ ...base, action: "BUY", confidence: 0.8 });
  assert.equal(r.passed, true);
  assert.equal(r.reasons.length, 0);
  assert.ok(r.suggestedQty > 0, "suggestedQty should be positive for a fundable, in-budget BUY");
  assert.ok(r.stopLoss < base.price, "a BUY stop-loss should sit below entry price");
});

test("riskCheck: BUY is rejected when confidence is below the 55% threshold", () => {
  const r = riskCheck({ ...base, action: "BUY", confidence: 0.4 });
  assert.equal(r.passed, false);
  assert.ok(r.reasons.some((x) => /confidence/i.test(x)));
});

test("riskCheck: BUY is rejected when the account has no spendable cash/budget left", () => {
  const r = riskCheck({ ...base, action: "BUY", confidence: 0.9, cash: 0 });
  assert.equal(r.passed, false);
  assert.equal(r.suggestedQty, 0);
  assert.ok(r.reasons.some((x) => /cash exhausted|size limit/i.test(x)));
});

test("riskCheck: high volatility raises the risk level and requires higher confidence", () => {
  const r = riskCheck({ ...base, action: "BUY", confidence: 0.6, volatility: 0.05 });
  assert.equal(r.riskLevel, "HIGH");
  assert.equal(r.passed, false, "0.6 confidence should not clear the 0.7 bar required at HIGH risk");
});

test("riskCheck: SELL is rejected when no position is held (insufficient position)", () => {
  const r = riskCheck({ ...base, action: "SELL", confidence: 1, currentQty: 0 });
  assert.equal(r.passed, false);
  assert.equal(r.suggestedQty, 0);
  assert.ok(r.reasons.some((x) => /no open position/i.test(x)));
});

test("riskCheck: SELL of a fully held position passes and suggests the full quantity", () => {
  const r = riskCheck({ ...base, action: "SELL", confidence: 1, currentQty: 5 });
  assert.equal(r.passed, true);
  assert.equal(r.suggestedQty, 5);
});

test("riskCheck: HOLD never passes (nothing to execute)", () => {
  const r = riskCheck({ ...base, action: "HOLD", confidence: 1 });
  assert.equal(r.passed, false);
  assert.ok(r.reasons.some((x) => /HOLD/i.test(x)));
});
