/**
 * RiskManager (MVP)
 * - Hard gate: ENABLE_TRADING=1 required (unless action is explicitly allowed)
 * - Runtime kill-switch: HALT_TRADING=1 via RPC (does not require restart)
 * - Notional cap and symbol allowlist
 */
export class RiskManager {
  constructor({ maxNotionalUSDT = 50, allowSymbols = [], logger = null } = {}) {
    this.allowSymbols = allowSymbols;
    this.logger = logger;

    this.haltTrading = false; // runtime kill-switch
    this.maxNotionalUSDT = Number(process.env.MAX_NOTIONAL_USDT || maxNotionalUSDT);
    this.orderTimeoutMs = Number(process.env.ORDER_TIMEOUT_MS || 15000);
    this.maxOpenOrders = Number(process.env.MAX_OPEN_ORDERS || 10);
    this.enableTrading = String(process.env.ENABLE_TRADING || "0") === "1";
  }

  refresh() {
    this.enableTrading = String(process.env.ENABLE_TRADING || "0") === "1";
    this.maxNotionalUSDT = Number(process.env.MAX_NOTIONAL_USDT || this.maxNotionalUSDT);
    this.orderTimeoutMs = Number(process.env.ORDER_TIMEOUT_MS || this.orderTimeoutMs);
    this.maxOpenOrders = Number(process.env.MAX_OPEN_ORDERS || this.maxOpenOrders);
  }

  setHalt(on = true, reason = "") {
    this.haltTrading = !!on;
    this.logger?.log("risk_halt", { on: this.haltTrading, reason: String(reason || "") });
  }

  validateOrderCreate({ symbol, side, orderType, qty, price, category = "linear", estNotional = null }) {
    this.refresh();

    if (this.haltTrading) throw new Error("Trading halted by kill-switch");
    if (!this.enableTrading) throw new Error("Trading disabled (set ENABLE_TRADING=1 to allow order.create)");
    if (category !== "linear") throw new Error("MVP supports category=linear only");

    if (!symbol || typeof symbol !== "string") throw new Error("symbol required");
    if (this.allowSymbols?.length && !this.allowSymbols.includes(symbol)) throw new Error(`symbol not allowed: ${symbol}`);

    if (side !== "Buy" && side !== "Sell") throw new Error("side must be Buy|Sell");
    if (orderType !== "Limit" && orderType !== "Market") throw new Error("orderType must be Limit|Market");

    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) throw new Error("qty must be > 0");

    const p = orderType === "Market" ? null : Number(price);
    if (orderType === "Limit") {
      if (!Number.isFinite(p) || p <= 0) throw new Error("price must be > 0 for Limit");
    }

    // notional cap
    const notional = Number.isFinite(estNotional)
      ? Number(estNotional)
      : (orderType === "Limit" && Number.isFinite(p) ? (q * p) : null);

    if (Number.isFinite(notional) && notional > this.maxNotionalUSDT) {
      throw new Error(`notional cap exceeded: ${notional} > ${this.maxNotionalUSDT}`);
    }

    return { q, p, notional };
  }
}
