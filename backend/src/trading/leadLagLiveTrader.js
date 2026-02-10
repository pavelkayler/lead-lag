import { PaperBroker } from "../paper/paperBroker.js";

export class LeadLagLiveTrader {
  constructor({ feed, leadLag, rest, risk, logger = null } = {}) {
    this.feed = feed;
    this.leadLag = leadLag;
    this.rest = rest;
    this.risk = risk;
    this.logger = logger;
    this.running = false;
    this.mode = "demo";
    this.params = {};
    this.lastActionTs = null;
    this.lastError = null;
    this._timer = null;
    this._lastLeaderBarT = null;
    this._cooldownLeft = 0;
  }

  status() { return { trading: this.running, mode: this.mode, params: this.params, lastActionTs: this.lastActionTs, lastError: this.lastError }; }

  start({ mode = "demo", params = {} } = {}) {
    this.mode = mode;
    this.params = {
      qtyUSDT: Number(params.qtyUSDT || 25),
      minCorr: Number(params.minCorr || 0.2),
      stdBars: Number(params.stdBars || 180),
      impulseZ: Number(params.impulseZ || 6),
      tpSigma: Number(params.tpSigma || 25),
      slSigma: Number(params.slSigma || 18),
      maxHoldBars: Number(params.maxHoldBars || 240),
      cooldownBars: Number(params.cooldownBars || 40),
    };
    this.running = true;
    if (!this._timer) {
      this._timer = setInterval(() => this._tick(), 1000);
      this._timer.unref?.();
    }
    return this.status();
  }

  stop() {
    this.running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    return this.status();
  }

  async _tick() {
    if (!this.running) return;
    try {
      if (this._cooldownLeft > 0) { this._cooldownLeft -= 1; return; }
      const pairs = this.leadLag.latest?.pairs || [];
      const top = pairs[0];
      if (!top || top.corr < this.params.minCorr) return;
      const leaderBars = this.feed.getBars(top.leader, 2);
      const lastBar = leaderBars[leaderBars.length - 1];
      if (!lastBar?.t || this._lastLeaderBarT === lastBar.t) return;
      this._lastLeaderBarT = lastBar.t;
      const leaderR = Number(lastBar.r);
      const vol = PaperBroker.rollingStd(this.feed.getReturns(top.leader, this.params.stdBars));
      if (!Number.isFinite(leaderR) || !Number.isFinite(vol) || vol <= 0) return;
      if (Math.abs(leaderR) < this.params.impulseZ * vol) return;

      const side = leaderR >= 0 ? "Buy" : "Sell";
      const symbol = top.follower;
      const mid = this.feed.getMid(symbol);
      if (!Number.isFinite(mid) || mid <= 0) return;
      const qty = Math.max(0.001, this.params.qtyUSDT / mid);
      const tpPct = Math.max(0.1, this.params.tpSigma / 100);
      const slPct = Math.max(0.1, this.params.slSigma / 100);
      const sign = side === "Buy" ? 1 : -1;
      const takeProfit = String(mid * (1 + sign * (tpPct / 100)));
      const stopLoss = String(mid * (1 - sign * (slPct / 100)));

      await this.rest.post("/v5/order/create", {
        category: "linear",
        symbol,
        side,
        orderType: "Market",
        qty: String(qty),
        timeInForce: "IOC",
        orderLinkId: `LL-${Date.now()}`,
        takeProfit,
        stopLoss,
      });
      this.lastActionTs = Date.now();
      this._cooldownLeft = this.params.cooldownBars;
    } catch (e) {
      this.lastError = String(e?.message || e);
      this.logger?.log("live_trader_tick_err", { error: this.lastError });
    }
  }
}
