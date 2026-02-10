export class MarketDataLayer {
  constructor({ feed, rest, logger }) {
    this.feed = feed;
    this.rest = rest;
    this.logger = logger;
    this.oiHistory = new Map();
    this.fundingHistory = new Map();
  }

  getTicker(symbol) {
    return this.feed.getTickerSnapshot(symbol) || {};
  }

  getBars(symbol, n = 120, source = "BT") {
    return this.feed.getBars(symbol, n, source) || [];
  }

  getMid(symbol) {
    return this.feed.getMid(symbol, "BT");
  }

  getTrades(symbol, windowMs) {
    return this.feed.getTrades(symbol, windowMs);
  }

  getLiquidations(symbol, windowMs) {
    return this.feed.getLiquidations(symbol, windowMs);
  }

  async refreshOI(symbol, interval = "5min", limit = 50) {
    try {
      const r = await this.rest.publicGet("/v5/market/open-interest", { category: "linear", symbol, intervalTime: interval, limit });
      const list = Array.isArray(r?.result?.list) ? r.result.list : [];
      const rows = list.map((x) => ({ ts: Number(x.timestamp), oi: Number(x.openInterest) })).filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.oi));
      this.oiHistory.set(symbol, rows.sort((a, b) => a.ts - b.ts));
    } catch (e) {
      this.logger?.log("range_oi_refresh_err", { symbol, error: e?.message || String(e) });
    }
  }

  async refreshFunding(symbol, limit = 200) {
    try {
      const r = await this.rest.publicGet("/v5/market/funding/history", { category: "linear", symbol, limit });
      const list = Array.isArray(r?.result?.list) ? r.result.list : [];
      const rows = list.map((x) => ({ ts: Number(x.fundingRateTimestamp), rate: Number(x.fundingRate) })).filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.rate));
      this.fundingHistory.set(symbol, rows.sort((a, b) => a.ts - b.ts));
    } catch (e) {
      this.logger?.log("range_funding_refresh_err", { symbol, error: e?.message || String(e) });
    }
  }
}
