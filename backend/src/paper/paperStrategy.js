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
    this.useFixedLeaders = false;
    this.allowedSources = new Set(["BT", "BNB"]);
    this.interExchangeArbEnabled = true;
    this.blacklistSymbols = new Set();
    this.blacklistBySource = new Map();
    this.noMatchAsLeaderCount = new Map();
    this.noMatchAsFollowerCount = new Map();
    this.noMatchPairCount = new Map();
    this.autoExcludedSeries = new Set();
    this.autoExcludeNoMatchThreshold = 100;
    this.debugAllowEntryWithoutImpulse = false;
    this.debugEntryCooldownMin = 45;
    this.riskMode = "OFF";
    this.riskImpulseMargin = 0.4;
    this.riskQtyMultiplier = 0.5;
    this.riskCooldownMin = 45;
    this.maxRiskEntriesPerHour = 1;
    this._lastRiskEntryAt = 0;
    this._riskEntryHistory = [];
    this._lastDebugEntryAt = 0;
    this.baseLeaders = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
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
    this.rejectDistance = { corrFail: [], impulseFail: [], edgeGateFail: [], confirmFail: [] };
    this.rejectSamples = { impulseFail: null, edgeGateFail: null };
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
    if (p.fixedLeaders === null) this.useFixedLeaders = false;
    if (Array.isArray(p.fixedLeaders)) { this.fixedLeaders = p.fixedLeaders.map((x) => String(x).toUpperCase()); this.useFixedLeaders = true; }
    if (p.useFixedLeaders != null) this.useFixedLeaders = !!p.useFixedLeaders;
    if (Array.isArray(p.allowedSources)) this.allowedSources = new Set(p.allowedSources.map((x) => String(x).toUpperCase()));
    if (p.interExchangeArbEnabled != null) this.interExchangeArbEnabled = !!p.interExchangeArbEnabled;
    if (p.autoExcludeNoMatchThreshold != null) this.autoExcludeNoMatchThreshold = Math.max(10, Math.round(n(p.autoExcludeNoMatchThreshold, this.autoExcludeNoMatchThreshold)));
    if (p.debugAllowEntryWithoutImpulse != null) this.debugAllowEntryWithoutImpulse = !!p.debugAllowEntryWithoutImpulse;
    if (p.debugEntryCooldownMin != null) this.debugEntryCooldownMin = Math.max(1, Math.round(n(p.debugEntryCooldownMin, this.debugEntryCooldownMin)));
    if (p.riskMode != null) {
      const mode = String(p.riskMode || "OFF").toUpperCase();
      this.riskMode = ["OFF", "LOW", "MED", "HIGH"].includes(mode) ? mode : "OFF";
    }
    if (p.riskImpulseMargin != null) this.riskImpulseMargin = Math.max(0, n(p.riskImpulseMargin, this.riskImpulseMargin));
    if (p.riskQtyMultiplier != null) this.riskQtyMultiplier = Math.min(1, Math.max(0.05, n(p.riskQtyMultiplier, this.riskQtyMultiplier)));
    if (p.riskCooldownMin != null) this.riskCooldownMin = Math.max(1, Math.round(n(p.riskCooldownMin, this.riskCooldownMin)));
    if (p.maxRiskEntriesPerHour != null) this.maxRiskEntriesPerHour = Math.max(1, Math.round(n(p.maxRiskEntriesPerHour, this.maxRiskEntriesPerHour)));
    if (Array.isArray(p.blacklistSymbols)) this.blacklistSymbols = new Set(p.blacklistSymbols.map((x) => String(x).toUpperCase()));
    if (Array.isArray(p.blacklist)) {
      this.blacklistSymbols = new Set();
      this.blacklistBySource = new Map();
      for (const b of p.blacklist) {
        const sym = String(b?.symbol || "").toUpperCase();
        if (!sym) continue;
        const src = Array.isArray(b?.sources) ? b.sources.map((x) => String(x).toUpperCase()) : [];
        if (!src.length) this.blacklistSymbols.add(sym);
        this.blacklistBySource.set(sym, src);
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
      useFixedLeaders: this.useFixedLeaders,
      allowedSources: Array.from(this.allowedSources),
      interExchangeArbEnabled: this.interExchangeArbEnabled,
      blacklistSymbols: Array.from(new Set([...this.blacklistSymbols, ...Array.from(this.blacklistBySource.keys())])),
      blacklist: Array.from(new Set([...this.blacklistSymbols, ...Array.from(this.blacklistBySource.keys())])).map((symbol) => ({ symbol, sources: this.blacklistBySource.get(symbol) || [] })),
      autoExcludeNoMatchThreshold: this.autoExcludeNoMatchThreshold,
      debugAllowEntryWithoutImpulse: this.debugAllowEntryWithoutImpulse,
      debugEntryCooldownMin: this.debugEntryCooldownMin,
      riskMode: this.riskMode,
      riskImpulseMargin: this.riskImpulseMargin,
      riskQtyMultiplier: this.riskQtyMultiplier,
      riskCooldownMin: this.riskCooldownMin,
      maxRiskEntriesPerHour: this.maxRiskEntriesPerHour,
    };
  }

  _isRiskModeEnabled() {
    return this.riskMode !== "OFF";
  }

  _canOpenRiskEntry() {
    const now = Date.now();
    const cooldownMs = Math.max(1, Number(this.riskCooldownMin || 45)) * 60_000;
    if ((now - Number(this._lastRiskEntryAt || 0)) < cooldownMs) return { ok: false, reason: "cooldown" };
    const hourAgo = now - 60 * 60 * 1000;
    this._riskEntryHistory = this._riskEntryHistory.filter((ts) => Number(ts || 0) >= hourAgo);
    if (this._riskEntryHistory.length >= Math.max(1, Number(this.maxRiskEntriesPerHour || 1))) {
      return { ok: false, reason: "hour_limit" };
    }
    return { ok: true, reason: "ok" };
  }


  _symbolBase(v) {
    const raw = String(v || "");
    return raw.includes("|") ? raw.split("|")[0] : raw;
  }

  _isSeriesBlacklisted(symbol, source = "BT") {
    const sym = String(symbol || "").toUpperCase();
    const src = String(source || "BT").toUpperCase();
    if (!sym) return false;
    if (this.blacklistSymbols.has(sym)) return true;
    const list = this.blacklistBySource.get(sym) || [];
    return list.includes(src);
  }

  _pairKey(a, b) {
    return `${a}->${b}`;
  }

  _updateNoMatchCounters(pairs = []) {
    const series = (Array.isArray(this.feed.listSeries?.()) ? this.feed.listSeries() : [])
      .filter((x) => this.allowedSources.has(String(x?.source || "").toUpperCase()));
    if (!series.length) return;

    const checkedPairs = new Set();
    const matched = new Set();
    for (const p of pairs) {
      const leader = `${String(this._symbolBase(p.leaderBase || p.leader) || "").toUpperCase()}|${String(p.leaderSource || "BT").toUpperCase()}`;
      const follower = `${String(this._symbolBase(p.followerBase || p.follower) || "").toUpperCase()}|${String(p.followerSource || "BT").toUpperCase()}`;
      if (!leader || !follower || leader === follower) continue;
      if (p.insufficientSamples === true || String(p.confirmLabel || "").toUpperCase() === "INSUFFICIENT_SAMPLES") continue;
      const forward = this._pairKey(leader, follower);
      const reverse = this._pairKey(follower, leader);
      checkedPairs.add(forward);
      checkedPairs.add(reverse);
      const isMatch = Number(p.confirmScore || p.confirm || 0) >= 3 && String(p.confirmLabel || "").toUpperCase() === "OK";
      if (isMatch) {
        matched.add(forward);
        matched.add(reverse);
      }
    }

    const keys = series.map((s) => `${String(s?.symbol || "").toUpperCase()}|${String(s?.source || "BT").toUpperCase()}`);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const left = keys[i];
        const right = keys[j];
        const fwd = this._pairKey(left, right);
        const rev = this._pairKey(right, left);
        if (!checkedPairs.has(fwd) && !checkedPairs.has(rev)) continue;
        const isMatched = matched.has(fwd) || matched.has(rev);
        if (isMatched) {
          this.noMatchPairCount.set(fwd, 0);
          this.noMatchPairCount.set(rev, 0);
        } else {
          this.noMatchPairCount.set(fwd, Number(this.noMatchPairCount.get(fwd) || 0) + 1);
          this.noMatchPairCount.set(rev, Number(this.noMatchPairCount.get(rev) || 0) + 1);
        }
      }
    }

    for (const key of keys) {
      const [symbol, source] = key.split("|");
      if (this.baseLeaders.has(symbol)) continue;
      if (this.autoExcludedSeries.has(key)) continue;
      let minNoMatch = Infinity;
      let worstKey = null;
      let worstCount = -1;
      for (const other of keys) {
        if (other === key) continue;
        const pk = this._pairKey(key, other);
        if (!checkedPairs.has(pk)) {
          minNoMatch = 0;
          continue;
        }
        const cnt = Number(this.noMatchPairCount.get(pk) || 0);
        if (cnt < minNoMatch) {
          minNoMatch = cnt;
        }
        if (cnt > worstCount) {
          worstCount = cnt;
          worstKey = other;
        }
      }
      if (!Number.isFinite(minNoMatch)) continue;
      this.noMatchAsLeaderCount.set(key, minNoMatch);
      this.noMatchAsFollowerCount.set(key, minNoMatch);
      if (minNoMatch >= this.autoExcludeNoMatchThreshold) {
        this.autoExcludedSeries.add(key);
        this.onAutoExclude?.({
          symbol,
          source,
          reason: "no_match_pairwise",
          minNoMatch,
          worstCounterpart: worstKey,
          worstCount,
          noMatchAsLeaderCount: minNoMatch,
          noMatchAsFollowerCount: minNoMatch,
          threshold: this.autoExcludeNoMatchThreshold,
          presetName: this.currentPresetName || null,
        });
      }
    }
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
    this._logThrottled("paper_setup", { event: "setup_cleared", reason, leader: this._pendingSetup.leader, follower: this._pendingSetup.follower, source: this._pendingSetup.followerSource, symbol: this._pendingSetup.follower, presetName: this.currentPresetName || null }, `setup_cleared:${reason}`, 5000);
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


  _countReject(key, status = null, distanceToPass = null, sample = null) {
    if (this.rejectCounters[key] != null) this.rejectCounters[key] += 1;
    if (Number.isFinite(distanceToPass) && this.rejectDistance[key]) this.rejectDistance[key].push(Number(distanceToPass));
    if (sample && this.rejectSamples[key] != null) this.rejectSamples[key] = sample;
    if (status) this.runtimeStatus = status;
  }

  consumeRejectStats() {
    const counters = { ...this.rejectCounters };
    const dist = Object.fromEntries(Object.entries(this.rejectDistance).map(([k, arr]) => [k, arr.slice()]));
    const samples = { ...this.rejectSamples };
    this.rejectCounters = { corrFail: 0, impulseFail: 0, edgeGateFail: 0, confirmFail: 0, setupExpired: 0, noCandidatePairs: 0 };
    this.rejectDistance = { corrFail: [], impulseFail: [], edgeGateFail: [], confirmFail: [] };
    this.rejectSamples = { impulseFail: null, edgeGateFail: null };
    return { counters, distance: dist, samples, runtimeStatus: this.runtimeStatus };
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

    const pairs = (this.leadLag.latest?.pairs || []).slice(0, 20);
    this._updateNoMatchCounters(pairs);

    if (this.interExchangeArbEnabled && (!this.allowedSources.has("BT") || !this.allowedSources.has("BNB"))) {
      this._countReject("noCandidatePairs", "interExchangeArbEnabled: нужны обе биржи (BT+BNB), пары не сформированы");
      this._logThrottled("paper_status", { event: "inter_exchange_requires_both", allowedSources: Array.from(this.allowedSources), presetName: this.currentPresetName || null }, "inter_exchange_requires_both", 8000);
      return;
    }

    const top = pairs.find((p) => {
      const leaderBase = this._symbolBase(p.leaderBase || p.leader);
      const followerBase = this._symbolBase(p.followerBase || p.follower);
      const leaderSource = String(p.leaderSource || "BT").toUpperCase();
      const followerSource = String(p.followerSource || "BT").toUpperCase();
      if (!this.allowedSources.has(leaderSource) || !this.allowedSources.has(followerSource)) return false;
      if (this.useFixedLeaders && !this.fixedLeaders.includes(String(leaderBase || "").toUpperCase())) return false;
      if (this.interExchangeArbEnabled) {
        if (!leaderBase || !followerBase || leaderBase !== followerBase) return false;
        if (leaderSource === followerSource) return false;
      }
      return !this._isSeriesBlacklisted(followerBase, followerSource);
    });
    const topLeader = this._symbolBase(top?.leaderBase || top?.leader);
    const topFollower = this._symbolBase(top?.followerBase || top?.follower);
    if (this._pendingSetup && (!top || this._pendingSetup.leader !== topLeader || this._pendingSetup.follower !== topFollower)) {
      this._clearPendingSetup("pair_changed");
    }

    if (this._pendingSetup) {
      const pendingLeaderBars = this.feed.getBars(this._pendingSetup.leader, 2, this._pendingSetup.leaderSource || "BT");
      const pendingLeaderLast = pendingLeaderBars.length ? pendingLeaderBars[pendingLeaderBars.length - 1] : null;
      if (pendingLeaderLast?.t && this._pendingSetup.lastLeaderBarT !== pendingLeaderLast.t) {
        this._pendingSetup.lastLeaderBarT = pendingLeaderLast.t;
        this._pendingSetup.expiresInBars -= 1;
        if (this._pendingSetup.expiresInBars <= 0) {
          this.logger?.log("paper_setup", { event: "setup_expired", leader: this._pendingSetup.leader, follower: this._pendingSetup.follower, side: this._pendingSetup.side, source: this._pendingSetup.followerSource, presetName: this.currentPresetName || null });
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
    const leader = this._symbolBase(top.leaderBase || top.leader);
    const follower = this._symbolBase(top.followerBase || top.follower);
    const followerSourceRaw = String(top.followerSource || "BT").toUpperCase();
    const followerSource = this.interExchangeArbEnabled ? "BT" : followerSourceRaw;

    const strictFactor = this._strictFactor();
    const effMinCorr = this.minCorr * strictFactor;
    if (top.corr == null || top.corr < effMinCorr) {
      this._countReject("corrFail", "Жду корреляцию…", effMinCorr - Number(top.corr || 0));
      this._logThrottled("paper_skip", { reason: "corr_below_min", corr: top.corr, minCorr: effMinCorr, baseMinCorr: this.minCorr, entryStrictness: this.entryStrictness }, "skip:corr");
      return;
    }

    const leaderSource = String(top?.leaderSource || "BT").toUpperCase();
    const leaderBars = this.feed.getBars(leader, 2, leaderSource);
    if (!leaderBars.length) return;
    const lastBar = leaderBars[leaderBars.length - 1];
    if (!lastBar?.t) return;
    const isNewLeaderBar = this._lastLeaderBarT !== lastBar.t;
    if (isNewLeaderBar) this._lastLeaderBarT = lastBar.t;

    if (!this._pendingSetup && !isNewLeaderBar) return;

    const lastR = Number(lastBar?.r);
    if (!Number.isFinite(lastR)) return;

    const leaderR = this.feed.getReturns(leader, this.stdBars, leaderSource);
    const leaderVol = PaperBroker.rollingStd(leaderR);
    if (!Number.isFinite(leaderVol) || leaderVol <= 0) return;

    const thr = this.impulseZ * strictFactor * leaderVol;
    const debugImpulseBypass = this.debugAllowEntryWithoutImpulse;
    const impulseZNow = leaderVol > 0 ? Math.abs(lastR) / leaderVol : 0;
    const impulseZThr = this.impulseZ * strictFactor;
    const riskImpulseMin = Math.max(0, impulseZThr - Math.max(0, Number(this.riskImpulseMargin || 0)));
    const riskWindowPass = this._isRiskModeEnabled() && impulseZNow >= riskImpulseMin;

    if (!this._pendingSetup && !debugImpulseBypass && Math.abs(lastR) < thr && !riskWindowPass) {
      this._countReject("impulseFail", "Жду импульс…", thr - Math.abs(lastR), {
        impulseZNow,
        impulseZThr,
      });
      this._logThrottled("paper_skip", { reason: "no_impulse", leader, leaderR: lastR, impulseThr: thr }, `skip:no_impulse:${leader}`);
      return;
    }

    if (!this._pendingSetup && debugImpulseBypass) {
      const cooldownMs = Math.max(1, Number(this.debugEntryCooldownMin || 45)) * 60_000;
      const waitLeft = cooldownMs - (Date.now() - Number(this._lastDebugEntryAt || 0));
      if (waitLeft > 0) {
        this.runtimeStatus = `Debug cooldown активен: ещё ${Math.ceil(waitLeft / 60_000)}м`;
        return;
      }
    }

    if (!this._pendingSetup) {
      const side = lastR >= 0 ? "Buy" : "Sell";
      const followerR = this.feed.getReturns(follower, this.stdBars, followerSource);
      const followerVol = PaperBroker.rollingStd(followerR);
      if (!Number.isFinite(followerVol) || followerVol <= 0) return;

      const tpR2 = this.tpSigma * followerVol;
      const tpR1 = tpR2 * this.tp1Frac;
      const slR = this.slSigma * followerVol;
      const brokerState = this.broker.getState();
      const costsR = (2 * ((Number(brokerState.feeBps) || 0) + (Number(brokerState.slippageBps) || 0))) / 10_000;
      const edgeGateR = costsR * this.edgeMult * strictFactor;
      if (tpR2 < edgeGateR) {
        this._countReject("edgeGateFail", "Edge gate блокирует вход…", edgeGateR - tpR2, {
          edgeNow: tpR2,
          edgeThr: edgeGateR,
        });
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
        leaderSource,
        followerSource,
        leaderThr: thr,
        impulseZNow,
        impulseZThr,
        isRiskCandidate: Math.abs(lastR) < thr,
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
      this.logger?.log("paper_setup", { event: "setup_created", leader, follower, side, corr: top.corr, tpR1, tpR2, slR, edgeGateR, ttlBars: this.setupTTLbars, source: followerSource, symbol: follower, presetName: this.currentPresetName || null });
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
      const gap = Math.abs(followerConfirmAbsMin) - Math.abs(Number(followerLastR || 0));
      this._countReject("confirmFail", "Setup создан, жду подтверждение…", gap);
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

    const riskCandidate = !!setup.isRiskCandidate;
    const riskAllowed = riskCandidate ? this._canOpenRiskEntry() : { ok: false, reason: "not_risk" };
    if (riskCandidate && !riskAllowed.ok) {
      this._countReject("impulseFail", "Жду импульс…", Math.max(0, Number(setup.impulseZThr || 0) - Number(setup.impulseZNow || 0)), {
        impulseZNow: setup.impulseZNow,
        impulseZThr: setup.impulseZThr,
      });
      this._logThrottled("paper_risk_skip", {
        reason: riskAllowed.reason,
        leader: setup.leader,
        follower: setup.follower,
        riskCooldownMin: this.riskCooldownMin,
        maxRiskEntriesPerHour: this.maxRiskEntriesPerHour,
      }, `risk_skip:${riskAllowed.reason}:${setup.leader}:${setup.follower}`, 5000);
      return;
    }

    const qtyMultiplier = riskCandidate ? Math.min(1, Math.max(0.05, Number(this.riskQtyMultiplier || 1))) : 1;
    const qtyUSDT = Math.max(1, Number(this.qtyUSDT || 0) * qtyMultiplier);

    try {
      this.broker.open({
        symbol: setup.follower,
        side: setup.side,
        entryMid,
        qtyUSDT,
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
          isRiskEntry: riskCandidate,
          riskMode: this.riskMode,
          riskQtyMultiplier: qtyMultiplier,
        },
      });

      if (riskCandidate) {
        const now = Date.now();
        this._lastRiskEntryAt = now;
        this._riskEntryHistory.push(now);
        this.logger?.log("paper_risk_entry", {
          event: "[RISK-ENTRY]",
          message: `[RISK-ENTRY] margin=${Number(this.riskImpulseMargin || 0).toFixed(2)}, impulseZNow=${Number(setup.impulseZNow || 0).toFixed(2)}, thr=${Number(setup.impulseZThr || 0).toFixed(2)}, qtyMult=${qtyMultiplier.toFixed(2)}`,
          leader: setup.leader,
          follower: setup.follower,
          source: setup.followerSource,
          mode: "paper",
          presetName: this.currentPresetName || null,
          margin: this.riskImpulseMargin,
          impulseZNow: setup.impulseZNow,
          impulseZThr: setup.impulseZThr,
          qtyMultiplier,
        });
      }

      this.runtimeStatus = "Сделка открыта";
      if (this.debugAllowEntryWithoutImpulse) this._lastDebugEntryAt = Date.now();
      this.logger?.log("paper_signal", {
        event: "opened_trade",
        leader: setup.leader,
        follower: setup.follower,
        side: setup.side,
        corr: setup.corr,
        presetName: this.currentPresetName || null,
        params: this.getParams(),
        debugImpulseBypass: this.debugAllowEntryWithoutImpulse,
        tpR1: setup.tpR1,
        tpR2: setup.tpR2,
        slR: setup.slR,
        isRiskEntry: riskCandidate,
        qtyUSDT,
      });
      this._broadcastState({ lastSignal: { leader: setup.leader, follower: setup.follower, side: setup.side, corr: setup.corr, tpR1: setup.tpR1, tpR2: setup.tpR2, slR: setup.slR } });
      this._pendingSetup = null;
    } catch (e) {
      this.logger?.log("paper_signal_err", { error: e?.message || String(e) });
    }
  }
}
