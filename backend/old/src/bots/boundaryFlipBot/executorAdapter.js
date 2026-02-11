export class BoundaryExecutorAdapter {
  constructor({ rest, logger = null }) {
    this.rest = rest;
    this.logger = logger;
  }

  async getInstrumentRules(symbol, mode = "real") {
    if (String(mode).toLowerCase() === "paper" && String(symbol || "").toUpperCase() === "TESTUSDT") {
      return { tickSize: 0.01, qtyStep: 0.001, minNotional: 1 };
    }
    const resp = await this.rest.publicGet("/v5/market/instruments-info", { category: "linear", symbol });
    const item = resp?.result?.list?.[0] || {};
    return {
      tickSize: Number(item?.priceFilter?.tickSize || 0),
      qtyStep: Number(item?.lotSizeFilter?.qtyStep || 0),
      minNotional: Number(item?.lotSizeFilter?.minNotionalValue || 0),
    };
  }

  async placeEntries({ mode, symbol, side, entries, cycleId }) {
    if (mode === "paper") {
      return entries.map((e) => ({ ...e, orderId: `paper-${cycleId}-${e.id}`, status: "NEW" }));
    }
    const out = [];
    for (const e of entries) {
      const res = await this.rest.post("/v5/order/create", {
        category: "linear",
        symbol,
        side: side === "LONG" ? "Buy" : "Sell",
        orderType: "Limit",
        qty: String(e.qty),
        price: String(e.entryPrice),
        timeInForce: "GTC",
        orderLinkId: `bflip-${cycleId}-${e.id}`,
      });
      out.push({ ...e, orderId: res?.result?.orderId || `live-${cycleId}-${e.id}`, status: "NEW" });
    }
    return out;
  }

  async closePosition({ mode, symbol, side, qty }) {
    if (mode === "paper") return { ok: true, paper: true };
    return this.rest.post("/v5/order/create", {
      category: "linear",
      symbol,
      side: side === "LONG" ? "Sell" : "Buy",
      orderType: "Market",
      qty: String(qty),
      reduceOnly: true,
      closeOnTrigger: true,
    });
  }

  async cancelAllEntries({ mode, symbol }) {
    if (mode === "paper") return { ok: true, paper: true };
    return this.rest.post("/v5/order/cancel-all", { category: "linear", symbol });
  }
}
