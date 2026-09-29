// Execution layer. Only the PaperBroker exists. A real broker adapter must implement
// ExecutionAdapter and pass security + compliance review before it is ever registered.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuote, getQuotes } from "./market.server";

export type OrderRequest = { userId: string; symbol: string; side: "BUY" | "SELL"; quantity: number; source: string; signalId?: string | null };
export type Fill = { tradeId: string; price: number; quantity: number; realizedPnl: number; cashAfter: number };

export interface ExecutionAdapter {
  readonly mode: "paper" | "live";
  submit(order: OrderRequest): Promise<Fill>;
}

export const DEFAULT_FEE_RATE = 0.001;

// Stable, machine-readable trade error. `code` lets callers branch on failure reason
// (e.g. show a specific message for INSUFFICIENT_CASH vs CONCURRENT_CONFLICT) without
// parsing free-form text; `message` stays human-readable for direct display/toasts.
export class TradeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TradeError";
    this.code = code;
  }
}

// The execute_paper_trade() Postgres function raises errors as "CODE: message".
// Anything that doesn't match that shape (an unexpected DB error) is not leaked
// verbatim to the browser — it's mapped to a generic TRADE_FAILED code instead.
function parseDbError(raw: string): TradeError {
  const match = /^([A-Z_]+):\s*(.*)$/s.exec(raw);
  if (match) return new TradeError(match[1]!, match[2]!.trim());
  return new TradeError("TRADE_FAILED", "Trade could not be completed. Please try again.");
}

export class PaperBroker implements ExecutionAdapter {
  readonly mode = "paper" as const;
  constructor(
    private db: SupabaseClient,
    private feeRate = DEFAULT_FEE_RATE,
  ) {}

  async submit(o: OrderRequest): Promise<Fill> {
    if (!(o.quantity > 0) || !Number.isFinite(o.quantity)) throw new TradeError("INVALID_QUANTITY", "Quantity must be positive");

    const price = (await getQuote(this.db, o.symbol)).price;

    // Atomic, row-locked execution — see supabase/migrations/20260927060000_*.sql.
    // execute_paper_trade() takes a row lock on the caller's portfolio (and their
    // position in this symbol, if any) for the duration of the transaction, so two
    // concurrent submissions for the same user can never both act on the same stale
    // cash_balance/quantity. This replaces the previous read -> compute -> write
    // sequence, which had a race window between the read and the write.
    const { data, error } = await this.db
      .rpc("execute_paper_trade", {
        _user_id: o.userId,
        _symbol: o.symbol,
        _side: o.side,
        _quantity: o.quantity,
        _price: price,
        _fee_rate: this.feeRate,
        _source: o.source,
        _signal_id: o.signalId ?? null,
      })
      .single();

    if (error) throw parseDbError(error.message);
    if (!data) throw new TradeError("TRADE_FAILED", "Trade could not be completed. Please try again.");

    const fill: Fill = {
      tradeId: data.trade_id,
      price: Number(data.fill_price),
      quantity: Number(data.fill_quantity),
      realizedPnl: Number(data.realized_pnl),
      cashAfter: Number(data.cash_after),
    };

    // Best-effort equity snapshot for the equity-curve chart. The trade itself has
    // already committed atomically above; a failure here must not undo or fail it.
    try {
      const { data: allPos } = await this.db.from("positions").select("symbol, quantity").eq("user_id", o.userId);
      const qs = allPos?.length ? await getQuotes(this.db, allPos.map((p) => p.symbol)) : [];
      // Never store an equity point that values a held symbol at 0 because its quote is missing.
      if ((allPos ?? []).some((p) => !qs.some((q) => q.symbol === p.symbol))) return fill;
      const equityAfter = fill.cashAfter + (allPos ?? []).reduce((a, p) => a + Number(p.quantity) * (qs.find((q) => q.symbol === p.symbol)?.price ?? 0), 0);
      await this.db.from("trades").update({ equity_after: equityAfter }).eq("id", fill.tradeId);
    } catch {
      // Non-critical — omitting one equity-curve point is fine; the trade stands.
    }

    return fill;
  }
}
