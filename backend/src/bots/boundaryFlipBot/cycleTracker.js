import { getLastClosedBar } from "./levels.js";

export class CycleTracker {
  constructor({ rest, executor, logger = null }) {
    this.rest = rest;
    this.executor = executor;
    this.logger = logger;
  }

  async getMark(symbol) {
    const t = await this.rest.publicGet("/v5/market/tickers", { category: "linear", symbol });
    return Number(t?.result?.list?.[0]?.markPrice || t?.result?.list?.[0]?.lastPrice || NaN);
  }

  async evaluate({ config, cycle, levels }) {
    const mark = await this.getMark(config.symbol);
    if (!Number.isFinite(mark)) return { action: null };
    if (!cycle.position) {
      const hit = cycle.openOrders.find((o) => (cycle.side === "LONG" ? mark <= o.entryPrice : mark >= o.entryPrice));
      if (!hit) return { action: null };
      cycle.position = { side: cycle.side, entryPrice: hit.entryPrice, qty: hit.qty, openedAt: Date.now() };
      return { action: "position_opened", mark };
    }

    const p = cycle.position;
    const pnlPct = p.side === "LONG" ? ((mark / p.entryPrice) - 1) * 100 : ((p.entryPrice / mark) - 1) * 100;
    const tpHit = p.side === "LONG" ? mark >= p.tpPrice : mark <= p.tpPrice;
    const slHit = p.side === "LONG" ? mark <= p.slPrice : mark >= p.slPrice;
    if (tpHit) return { action: "close", reason: "TP", mark, pnlPct };
    if (slHit) return { action: "close", reason: "SL", mark, pnlPct };

    if (config.enableEarlyExit && pnlPct >= config.minEarlyProfitPct) {
      const bar = getLastClosedBar(levels);
      if (bar) {
        const bodyAbsPct = (Math.abs(bar.close - bar.open) / Math.max(1e-9, bar.open)) * 100;
        const range = Math.max(1e-9, bar.high - bar.low);
        const ratio = Math.abs(bar.close - bar.open) / range;
        const reverse = p.side === "LONG" ? (bar.close < bar.open) : (bar.close > bar.open);
        if (reverse && bodyAbsPct >= config.minReverseBodyPct && ratio >= config.minBodyToRangeRatio) {
          return { action: "close", reason: "EARLY", mark, pnlPct };
        }
      }
    }
    return { action: null };
  }
}
