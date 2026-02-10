import { PaperBroker } from "./paperBroker.js";

export class LeadLagPaperStrategy {
  constructor({ feed, leadLag, broker, hub, logger = null } = {}) {
    this.feed = feed;
    this.leadLag = leadLag;
    this.broker = broker;
    this.hub = hub;
    this.logger = logger;

    this.enabled = false;

    this.qtyUSDT = 25;
    this.minCorr = 0.15;
    this.stdBars = 120;
    this.impulseZ = 2.5;
    this.tpSigma = 1.5;
    this.slSigma = 1.0;
    this.maxHoldBars = 20;
    this.cooldownBars = 20;

    this._timer = null;
    this._lastLeaderBarT = null;
    this._cooldownLeft = 0;
    this._lastFollowerBarT = null;
  }

  setParams(p = {}) {
    const n = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);

    if (p.qtyUSDT != null) this.qtyUSDT = Math.max(1, n(p.qtyUSDT, this.qtyUSDT));
    if (p.minCorr != null) this.minCorr = Math.max(0, n(p.minCorr, this.minCorr));
    if (p.stdBars != null) this.stdBars = Math.max(30, n(p.stdBars, this.stdBars));
    if (p.impulseZ != null) this.impulseZ = Math.max(0.5, n(p.impulseZ, this.impulseZ));
    if (p.tpSigma != null) this.tpSigma = Math.max(0.1, n(p.tpSigma, this.tpSigma));
    if (p.slSigma != null) this.slSigma = Math.max(0.1, n(p.slSigma, this.slSigma));
    if (p.maxHoldBars != null) this.maxHoldBars = Math.max(1, n(p.maxHoldBars, this.maxHoldBars));
    if (p.cooldownBars != null) this.cooldownBars = Math.max(0, n(p.cooldownBars, this.cooldownBars));

    this.logger?.log("paper_params", this.getParams());
  }

  getParams() {
    return {
      enabled: this.enabled,
      qtyUSDT: this.qtyUSDT,
      minCorr: this.minCorr,
      stdBars: this.stdBars,
      impulseZ: this.impulseZ,
      tpSigma: this.tpSigma,
      slSigma: this.slSigma,
      maxHoldBars: this.maxHoldBars,
      cooldownBars: this.cooldownBars,
      cooldownLeft: this._cooldownLeft,
    };
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), 250);
    this._timer.unref?.();
  }

  stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  enable(on = true) {
    this.enabled = !!on;
    this.logger?.log("paper_enabled", { enabled: this.enabled });
  }

  _broadcastState(extra = {}) {
    this.hub.broadcast("paper", {
      ts: Date.now(),
      params: this.getParams(),
      state: this.broker.getState(),
      ...extra,
    });
  }

  _tick() {
    // advance hold based on follower bars
    const pos = this.broker.position;
    if (pos) {
      const bars = this.feed.getBars(pos.symbol, 1);
      const b = bars.length ? bars[bars.length - 1] : null;
      if (b?.t && this._lastFollowerBarT !== b.t) {
        this._lastFollowerBarT = b.t;
        this.broker.advanceHold(pos.symbol);
      }
    }

    // mark-to-market and maybe close
    if (pos) {
      const mid = this.feed.getMid(pos.symbol);
      if (mid != null) {
        const trade = this.broker.update(pos.symbol, mid, { reason: "tick" });
        if (trade) {
          this._cooldownLeft = this.cooldownBars;
          this._broadcastState({ lastTrade: trade });
        }
      }
    }

    if (!this.enabled) return;
    if (!this.feed?.running) return;
    if (this.broker.position) return;

    if (this._cooldownLeft > 0) {
      this._cooldownLeft--;
      return;
    }

    const pairs = this.leadLag.latest?.pairs || [];
    if (!pairs.length) return;

    const top = pairs[0];
    if (top.corr == null || top.corr < this.minCorr) return;

    const leader = top.leader;
    const follower = top.follower;

    const leaderBars = this.feed.getBars(leader, 2);
    if (!leaderBars.length) return;
    const lastBar = leaderBars[leaderBars.length - 1];
    if (!lastBar?.t) return;
    if (this._lastLeaderBarT === lastBar.t) return;
    this._lastLeaderBarT = lastBar.t;

    const lastR = Number(lastBar?.r);
    if (!Number.isFinite(lastR)) return;

    const leaderR = this.feed.getReturns(leader, this.stdBars);
    const leaderVol = PaperBroker.rollingStd(leaderR);
    if (!Number.isFinite(leaderVol) || leaderVol <= 0) return;

    const thr = this.impulseZ * leaderVol;
    if (Math.abs(lastR) < thr) return;

    const side = lastR >= 0 ? "Buy" : "Sell";

    const followerR = this.feed.getReturns(follower, this.stdBars);
    const followerVol = PaperBroker.rollingStd(followerR);
    if (!Number.isFinite(followerVol) || followerVol <= 0) return;

    const tpR = this.tpSigma * followerVol;
    const slR = this.slSigma * followerVol;

    const entryMid = this.feed.getMid(follower);
    if (entryMid == null) return;

    try {
      this.broker.open({
        symbol: follower,
        side,
        entryMid,
        qtyUSDT: this.qtyUSDT,
        tpR,
        slR,
        maxHoldBars: this.maxHoldBars,
        meta: {
          leader,
          corr: top.corr,
          bestLagBars: top.bestLagBars,
          lagMs: top.bestLagMs,
          leaderR: lastR,
          leaderThr: thr,
        },
      });

      this.logger?.log("paper_signal", { leader, follower, side, corr: top.corr, leaderR: lastR, thr, tpR, slR, maxHoldBars: this.maxHoldBars });
      this._broadcastState({ lastSignal: { leader, follower, side, corr: top.corr, leaderR: lastR, thr, tpR, slR } });
    } catch (e) {
      this.logger?.log("paper_signal_err", { error: e?.message || String(e) });
    }
  }
}
