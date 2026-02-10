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
    this.edgeMult = 5;
    this.minFollowerConfirmZ = 0.25;
    this.setupTTLbars = 3;
    this.tp1Frac = 0.6;
    this.enableTrendFilter = true;
    this.trendBars = 5;
    this.trendMinZ = 0.5;
    this.entryStrictness = 65;
    this.fixedLeaders = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    this.blacklistSymbols = new Set();
    this.blacklistBySource = new Map();
    this.attemptsBySymbol = new Map();
    this.onAutoExclude = null;

    this._timer = null;
    this._lastLeaderBarT = null;
    this._cooldownLeft = 0;
    this._lastFollowerBarT = null;
    this._pendingSetup = null;
    this._logCooldownMs = 7000;
    this._lastLogAt = new Map();
    this.currentPresetName = null;
    this.rejectCounters = { corrFail: 0, impulseFail: 0, edgeGateFail: 0, confirmFail: 0, setupExpired: 0, noCandidatePairs: 0 };
    this.runtimeStatus = "Сканирую пары…";
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
    if (p.edgeMult != null) this.edgeMult = Math.max(1, n(p.edgeMult, this.edgeMult));
    if (p.minFollowerConfirmZ != null) this.minFollowerConfirmZ = Math.max(0, n(p.minFollowerConfirmZ, this.minFollowerConfirmZ));
    if (p.setupTTLbars != null) this.setupTTLbars = Math.max(1, Math.round(n(p.setupTTLbars, this.setupTTLbars)));
    if (p.tp1Frac != null) this.tp1Frac = Math.min(0.95, Math.max(0.05, n(p.tp1Frac, this.tp1Frac)));
    if (p.enableTrendFilter != null) this.enableTrendFilter = !!p.enableTrendFilter;
    if (p.trendBars != null) this.trendBars = Math.max(2, Math.round(n(p.trendBars, this.trendBars)));
    if (p.trendMinZ != null) this.trendMinZ = Math.max(0, n(p.trendMinZ, this.trendMinZ));
    if (p.entryStrictness != null) this.entryStrictness = Math.min(100, Math.max(0, n(p.entryStrictness, this.entryStrictness)));
    if (p.name != null) this.currentPresetName = String(p.name);
    if (Array.isArray(p.fixedLeaders)) this.fixedLeaders = p.fixedLeaders.map((x) => String(x).toUpperCase());
    if (Array.isArray(p.blacklistSymbols)) this.blacklistSymbols = new Set(p.blacklistSymbols.map((x) => String(x).toUpperCase()));
    if (Array.isArray(p.blacklist)) {
      this.blacklistSymbols = new Set();
      this.blacklistBySource = new Map();
      for (const b of p.blacklist) {
        const sym = String(b?.symbol || "").toUpperCase();
        if (!sym) continue;
        this.blacklistSymbols.add(sym);
        this.blacklistBySource.set(sym, Array.isArray(b?.sources) ? b.sources.map((x) => String(x).toUpperCase()) : []);
      }
    }

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
      edgeMult: this.edgeMult,
      minFollowerConfirmZ: this.minFollowerConfirmZ,
      setupTTLbars: this.setupTTLbars,
      tp1Frac: this.tp1Frac,
      enableTrendFilter: this.enableTrendFilter,
      trendBars: this.trendBars,
      trendMinZ: this.trendMinZ,
      entryStrictness: this.entryStrictness,
      currentPresetName: this.currentPresetName,
      fixedLeaders: this.fixedLeaders,
      blacklistSymbols: Array.from(this.blacklistSymbols),
      blacklist: Array.from(this.blacklistSymbols).map((symbol) => ({ symbol, sources: this.blacklistBySource.get(symbol) || [] })),
    };
  }


  _symbolBase(v) {
    const raw = String(v || "");
    return raw.includes("|") ? raw.split("|")[0] : raw;
  }

  _countAttemptFor(symbol, reason = "") {
    const s = String(symbol || "").toUpperCase();
    if (!s) return;
    const next = (this.attemptsBySymbol.get(s) || 0) + 1;
    this.attemptsBySymbol.set(s, next);
    if (next < 500 || this.blacklistSymbols.has(s)) return;

    const sources = this.feed?.getSymbolSources?.(s) || [];
    this.blacklistSymbols.add(s);
    this.blacklistBySource.set(s, sources);
    this.onAutoExclude?.({ symbol: s, sources, attempts: next, reason: reason || "500_attempts_no_trade", presetName: this.currentPresetName || null });
  }

  _strictFactor() {
    return Math.min(1.4, Math.max(0.5, Number(this.entryStrictness || 65) / 65));
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
    this._clearPendingSetup("stop");
  }

  enable(on = true) {
    this.enabled = !!on;
    if (!this.enabled) this._clearPendingSetup("disable");
    this.logger?.log("paper_enabled", { enabled: this.enabled });
  }

  _logThrottled(type, payload = {}, throttleKey = type, cooldownMs = this._logCooldownMs) {
    const now = Date.now();
    const last = this._lastLogAt.get(throttleKey) || 0;
    if (now - last < cooldownMs) return;
    this._lastLogAt.set(throttleKey, now);
    this.logger?.log(type, payload);
  }

  _clearPendingSetup(reason = "clear") {
    if (!this._pendingSetup) return;
    this._logThrottled("paper_setup", { event: "setup_cleared", reason, leader: this._pendingSetup.leader, follower: this._pendingSetup.follower }, `setup_cleared:${reason}`, 5000);
    this._pendingSetup = null;
  }

  _isSideAligned(side, value) {
    return side === "Buy" ? value > 0 : value < 0;
  }

  _broadcastState(extra = {}) {
    this.hub.broadcast("paper", {
      ts: Date.now(),
      params: this.getParams(),
      state: this.broker.getState(),
      ...extra,
    });
  }


  _countReject(key, status = null) {
    if (this.rejectCounters[key] != null) this.rejectCounters[key] += 1;
    if (status) this.runtimeStatus = status;
  }

  consumeRejectStats() {
    const counters = { ...this.rejectCounters };
    this.rejectCounters = { corrFail: 0, impulseFail: 0, edgeGateFail: 0, confirmFail: 0, setupExpired: 0, noCandidatePairs: 0 };
    return { counters, runtimeStatus: this.runtimeStatus };
  }

  _tick() {
    const pos = this.broker.position;
    if (pos) {
      const bars = this.feed.getBars(pos.symbol, 1);
      const b = bars.length ? bars[bars.length - 1] : null;
      if (b?.t && this._lastFollowerBarT !== b.t) {
        this._lastFollowerBarT = b.t;
        this.broker.advanceHold(pos.symbol);
      }
    }

    if (pos) {
      const mid = this.feed.getMid(pos.symbol);
      if (mid != null) {
        if (!pos.tp1Hit && Number.isFinite(pos.tpR1) && pos.tpR1 > 0) {
          const r = Math.log(mid / pos.entryMid);
          if ((pos.side === "Buy" && r >= pos.tpR1) || (pos.side === "Sell" && r <= -pos.tpR1)) {
            pos.tp1Hit = true;
            pos.stopAtEntry = true;
            this.logger?.log("paper_tp1", { event: "tp1_hit_be_enabled", symbol: pos.symbol, side: pos.side, tpR1: pos.tpR1, tpR2: pos.tpR2 ?? pos.tpR, holdBars: pos.holdBars });
          }
        }
        const trade = this.broker.update(pos.symbol, mid, { reason: "tick" });
        if (trade) {
          this._cooldownLeft = this.cooldownBars;
          this._clearPendingSetup("position_closed");
          this._broadcastState({ lastTrade: trade });
        }
      }
    }

    if (!this.enabled) return;
    if (!this.feed?.running) return;
    if (this.broker.position) return;

    const pairs = (this.leadLag.latest?.pairs || []).slice(0, 10);
    const top = pairs.find((p) => {
      const leaderBase = this._symbolBase(p.leaderBase || p.leader);
      const followerBase = this._symbolBase(p.followerBase || p.follower);
      return this.fixedLeaders.includes(String(leaderBase || "").toUpperCase()) && !this.blacklistSymbols.has(String(followerBase || "").toUpperCase());
    });
    const topLeader = this._symbolBase(top?.leaderBase || top?.leader);
    const topFollower = this._symbolBase(top?.followerBase || top?.follower);
    if (this._pendingSetup && (!top || this._pendingSetup.leader !== topLeader || this._pendingSetup.follower !== topFollower)) {
      this._clearPendingSetup("pair_changed");
    }

    if (this._pendingSetup) {
      const pendingLeaderBars = this.feed.getBars(this._pendingSetup.leader, 2);
      const pendingLeaderLast = pendingLeaderBars.length ? pendingLeaderBars[pendingLeaderBars.length - 1] : null;
      if (pendingLeaderLast?.t && this._pendingSetup.lastLeaderBarT !== pendingLeaderLast.t) {
        this._pendingSetup.lastLeaderBarT = pendingLeaderLast.t;
        this._pendingSetup.expiresInBars -= 1;
        if (this._pendingSetup.expiresInBars <= 0) {
          this.logger?.log("paper_setup", { event: "setup_expired", leader: this._pendingSetup.leader, follower: this._pendingSetup.follower, side: this._pendingSetup.side });
          this._countReject("setupExpired", "Setup создан, ждём подтверждение…");
          this._pendingSetup = null;
        }
      }
    }

    if (this._cooldownLeft > 0) {
      this._cooldownLeft--;
      return;
    }

    if (!pairs.length || !top) {
      this._countReject("noCandidatePairs", "Сканирую пары…");
      return;
    }
    const strictFactor = this._strictFactor();
    const effMinCorr = this.minCorr * strictFactor;
    if (top.corr == null || top.corr < effMinCorr) {
      this._countReject("corrFail", "Жду корреляцию…");
      this._countAttemptFor(follower, "corr");
      this._logThrottled("paper_skip", { reason: "corr_below_min", corr: top.corr, minCorr: effMinCorr, baseMinCorr: this.minCorr, entryStrictness: this.entryStrictness }, "skip:corr");
      return;
    }

    const leader = this._symbolBase(top.leaderBase || top.leader);
    const follower = this._symbolBase(top.followerBase || top.follower);
    const followerSource = String(top.followerSource || "BT").toUpperCase();

    const leaderBars = this.feed.getBars(leader, 2);
    if (!leaderBars.length) return;
    const lastBar = leaderBars[leaderBars.length - 1];
    if (!lastBar?.t) return;
    const isNewLeaderBar = this._lastLeaderBarT !== lastBar.t;
    if (isNewLeaderBar) this._lastLeaderBarT = lastBar.t;

    if (!this._pendingSetup && !isNewLeaderBar) return;

    const lastR = Number(lastBar?.r);
    if (!Number.isFinite(lastR)) return;

    const leaderR = this.feed.getReturns(leader, this.stdBars);
    const leaderVol = PaperBroker.rollingStd(leaderR);
    if (!Number.isFinite(leaderVol) || leaderVol <= 0) return;

    const thr = this.impulseZ * strictFactor * leaderVol;
    if (!this._pendingSetup && Math.abs(lastR) < thr) {
      this._countReject("impulseFail", "Жду импульс…");
      this._countAttemptFor(follower, "impulse");
      this._logThrottled("paper_skip", { reason: "no_impulse", leader, leaderR: lastR, impulseThr: thr }, `skip:no_impulse:${leader}`);
      return;
    }

    if (!this._pendingSetup) {
      const side = lastR >= 0 ? "Buy" : "Sell";
      const followerR = this.feed.getReturns(follower, this.stdBars);
      const followerVol = PaperBroker.rollingStd(followerR);
      if (!Number.isFinite(followerVol) || followerVol <= 0) return;

      const tpR2 = this.tpSigma * followerVol;
      const tpR1 = tpR2 * this.tp1Frac;
      const slR = this.slSigma * followerVol;
      const brokerState = this.broker.getState();
      const costsR = (2 * ((Number(brokerState.feeBps) || 0) + (Number(brokerState.slippageBps) || 0))) / 10_000;
      const edgeGateR = costsR * this.edgeMult * strictFactor;
      if (tpR2 < edgeGateR) {
        this._countReject("edgeGateFail", "Edge gate блокирует вход…");
        this._countAttemptFor(follower, "edge");
        this._logThrottled("paper_gate_skip", { reason: "edge_gate_fail", leader, follower, tpR2, edgeGateR, costsR, edgeMult: this.edgeMult }, `gate:edge:${leader}:${follower}`);
        return;
      }

      this._pendingSetup = {
        createdAt: Date.now(),
        leader,
        follower,
        side,
        corr: top.corr,
        bestLagBars: top.bestLagBars,
        bestLagMs: top.bestLagMs,
        leaderR: lastR,
        leaderThr: thr,
        leaderVol,
        followerVol,
        tpR1,
        tpR2,
        slR,
        edgeGateR,
        expiresInBars: this.setupTTLbars,
        lastLeaderBarT: lastBar.t,
        lastFollowerBarT: null,
      };
      this.runtimeStatus = "Setup создан, жду подтверждение…";
      this.logger?.log("paper_setup", { event: "setup_created", leader, follower, side, corr: top.corr, tpR1, tpR2, slR, edgeGateR, ttlBars: this.setupTTLbars });
      return;
    }

    const setup = this._pendingSetup;
    const followerBars = this.feed.getBars(setup.follower, 2);
    const followerLastBar = followerBars.length ? followerBars[followerBars.length - 1] : null;
    if (!followerLastBar?.t || setup.lastFollowerBarT === followerLastBar.t) return;
    setup.lastFollowerBarT = followerLastBar.t;

    const followerLastR = Number(followerLastBar.r);
    const followerConfirmAbsMin = this.minFollowerConfirmZ * strictFactor * setup.followerVol;
    const followerConfirmed = Number.isFinite(followerLastR)
      && this._isSideAligned(setup.side, followerLastR)
      && Math.abs(followerLastR) >= followerConfirmAbsMin;

    let trendConfirmed = true;
    let leaderTrendR = null;
    if (this.enableTrendFilter) {
      const trendReturns = this.feed.getReturns(setup.leader, this.trendBars);
      leaderTrendR = trendReturns.reduce((acc, v) => acc + (Number(v) || 0), 0);
      const trendThr = this.trendMinZ * setup.leaderVol;
      trendConfirmed = this._isSideAligned(setup.side, leaderTrendR) && Math.abs(leaderTrendR) >= trendThr;
    }

    if (!followerConfirmed || !trendConfirmed) {
      this._countReject("confirmFail", "Setup создан, жду подтверждение…");
      this._logThrottled("paper_trigger_skip", {
        reason: "trigger_confirm_not_met",
        side: setup.side,
        leader: setup.leader,
        follower: setup.follower,
        followerLastR,
        followerConfirmAbsMin,
        trendFilterEnabled: this.enableTrendFilter,
        leaderTrendR,
      }, `trigger_fail:${setup.leader}:${setup.follower}`);
      return;
    }

    const entryMid = this.feed.getMid(setup.follower);
    if (entryMid == null) return;

    try {
      this.broker.open({
        symbol: setup.follower,
        side: setup.side,
        entryMid,
        qtyUSDT: this.qtyUSDT,
        tpR: setup.tpR2,
        tpR1: setup.tpR1,
        tpR2: setup.tpR2,
        slR: setup.slR,
        maxHoldBars: this.maxHoldBars,
        meta: {
          leader: setup.leader,
          follower: setup.follower,
          followerSource,
          corr: setup.corr,
          bestLagBars: setup.bestLagBars,
          lagMs: setup.bestLagMs,
          leaderR: setup.leaderR,
          leaderThr: setup.leaderThr,
          leaderVol: setup.leaderVol,
          followerVol: setup.followerVol,
          edgeGateR: setup.edgeGateR,
          presetName: this.currentPresetName || null,
        },
      });

      this.runtimeStatus = "Сделка открыта";
      this.logger?.log("paper_signal", {
        event: "opened_trade",
        leader: setup.leader,
        follower: setup.follower,
        side: setup.side,
        corr: setup.corr,
        presetName: this.currentPresetName || null,
        params: this.getParams(),
        tpR1: setup.tpR1,
        tpR2: setup.tpR2,
        slR: setup.slR,
      });
      this._broadcastState({ lastSignal: { leader: setup.leader, follower: setup.follower, side: setup.side, corr: setup.corr, tpR1: setup.tpR1, tpR2: setup.tpR2, slR: setup.slR } });
      this._pendingSetup = null;
    } catch (e) {
      this.logger?.log("paper_signal_err", { error: e?.message || String(e) });
    }
  }
}
