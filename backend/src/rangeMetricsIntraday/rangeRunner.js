import { mergeRangeConfig, validateRangeConfig } from "./configSchema.js";
import { MarketDataLayer } from "./marketDataLayer.js";
import { computeFeatures } from "./featureEngine.js";
import { detectRegimeBTC } from "./regimeDetector.js";
import { selectUniverse } from "./universeSelector.js";
import { calcRangeBands } from "./rangeModel.js";
import { makeNoTrade, makeTradePlan } from "./intents.js";

export class RangeMetricsRunner {
  constructor({ feed, rest, hub, logger, risk }) {
    this.feed = feed;
    this.rest = rest;
    this.hub = hub;
    this.logger = logger;
    this.risk = risk;
    this.mdl = new MarketDataLayer({ feed, rest, logger });
    this.cfg = mergeRangeConfig();
    this.state = "STOPPED";
    this.startedAt = null;
    this.endedAt = null;
    this.loop = null;
    this.scanLoop = null;
    this.features = {};
    this.ranges = {};
    this.candidates = [];
    this.lastPlan = null;
    this.lastDecisionTs = null;
    this.lastScanTs = null;
    this.regime = { regime: "UNCLEAR" };
    this.counters = { signals: 0, entries: 0, tp1: 0, tp2: 0, sl: 0, notrade: 0 };
    this.killSwitchActive = false;
  }

  emit(kind, payload = {}) {
    this.hub.broadcast("rangeMetrics", { kind, ts: Date.now(), payload });
  }

  status() {
    const now = Date.now();
    return {
      state: this.state,
      mode: this.cfg.mode,
      config: this.cfg,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      uptimeSec: this.startedAt ? Math.floor((now - this.startedAt) / 1000) : 0,
      btcRegime: this.regime?.regime || "UNCLEAR",
      killSwitchActive: this.killSwitchActive,
      openPositionsCount: 0,
      maxPositions: this.cfg.maxPositions,
      lastScanTs: this.lastScanTs,
      lastDecisionTs: this.lastDecisionTs,
      counters: this.counters,
      latestPlan: this.lastPlan,
    };
  }

  async start(partial = {}) {
    if (this.state === "RUNNING" || this.state === "STARTING") return this.status();
    this.cfg = validateRangeConfig({ ...this.cfg, ...(partial || {}) });
    this.state = "STARTING";
    this.startedAt = Date.now();
    this.endedAt = null;
    this.emit("status", this.status());

    this.feed.setSymbols(Array.from(new Set(["BTCUSDT", ...this.cfg.symbols])));
    this.feed.start();

    await this.selfCheck();
    this.state = "RUNNING";
    this.emit("status", this.status());

    this.loop = setInterval(() => this.decisionLoop().catch((e) => this.emit("error", { msg: e?.message || String(e) })), 1500);
    this.scanLoop = setInterval(() => this.scanLoopTick().catch((e) => this.emit("error", { msg: e?.message || String(e) })), this.cfg.scanIntervalSec * 1000);
    this.scanLoop.unref?.();
    this.loop.unref?.();

    await this.scanLoopTick();
    return this.status();
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    if (this.scanLoop) clearInterval(this.scanLoop);
    this.loop = null;
    this.scanLoop = null;
    this.state = "STOPPED";
    this.endedAt = Date.now();
    this.emit("status", this.status());
    return this.status();
  }

  setConfig(partial = {}) {
    this.cfg = validateRangeConfig({ ...this.cfg, ...(partial || {}) });
    this.emit("log", { level: "info", msg: "configUpdated", data: this.cfg });
    this.emit("status", this.status());
    return this.cfg;
  }

  getCandidates() { return this.candidates; }

  async selfCheck() {
    const btc = this.feed.getTickerSnapshot("BTCUSDT");
    if (!btc) this.emit("log", { level: "warn", msg: "Self-check: BTC ticker not ready yet" });
    await Promise.all(this.cfg.symbols.slice(0, 10).map((s) => Promise.all([this.mdl.refreshOI(s), this.mdl.refreshFunding(s)])));
  }

  async scanLoopTick() {
    const symbols = this.cfg.symbols;
    for (const s of symbols) {
      this.features[s] = computeFeatures(s, this.mdl, this.cfg);
      this.ranges[s] = calcRangeBands(s, this.mdl, this.cfg);
    }
    this.regime = detectRegimeBTC(this.mdl, this.cfg);
    this.candidates = selectUniverse(symbols, this.features, this.ranges, this.cfg).slice(0, this.cfg.shortlistForSignals);
    this.lastScanTs = Date.now();
    this.emit("candidates", this.candidates);
    this.emit("status", this.status());
  }

  async decisionLoop() {
    if (this.state !== "RUNNING") return;
    const now = Date.now();
    const top = this.candidates.slice(0, this.cfg.shortlistForSignals);
    for (const c of top) {
      const reasons = [];
      if (this.cfg.tradeOnlyCrab && this.regime.regime !== "CRAB") reasons.push({ code: "regime", label: "CRAB only", value: this.regime.regime, threshold: "CRAB", pass: false });
      if (!c.pass) reasons.push(...c.blockers.filter((b) => !b.pass));
      if (!(c.nearSupport || c.nearResistance)) reasons.push({ code: "range", label: "Not near range bands", value: "middle", threshold: "near S/R", pass: false });
      const f = this.features[c.symbol] || {};
      if (Number(f.volZ || 0) < 0.2) reasons.push({ code: "volz", label: "VolZ low", value: f.volZ, threshold: 0.2, pass: false });
      const hasLiq = Number(f.liqSpike || 0) > 0.1;
      if (!hasLiq) reasons.push({ code: "liq", label: "No liquidation cluster", value: f.liqSpike, threshold: 0.1, pass: false });

      if (reasons.length) {
        this.counters.notrade += 1;
        const rec = makeNoTrade(c.symbol, reasons.slice(0, 3), {
          regime: this.regime.regime,
          nearSupport: c.nearSupport,
          nearResistance: c.nearResistance,
          volZ: f.volZ,
          oiDeltaPct15m: f.oiDeltaPct15m,
          liqSpike: f.liqSpike,
          cvdSlope: f.cvdSlope,
          fundingScore: f.fundingScore,
        });
        this.emit("noTrade", rec);
        if (this.cfg.logNoEntryEvery10s && (now % (this.cfg.noEntryLogIntervalSec * 1000) < 1800)) {
          this.emit("log", { level: "info", symbol: c.symbol, msg: "No entry blockers", data: reasons.slice(0, 3) });
        }
        continue;
      }

      const side = c.nearSupport ? "Buy" : "Sell";
      const price = this.mdl.getMid(c.symbol);
      const qtyPct1 = this.cfg.enable25x4 || this.cfg.entryScheme === "25x4" ? 25 : 50;
      const qtyPct2 = this.cfg.enable25x4 || this.cfg.entryScheme === "25x4" ? 25 : 50;
      const plan = makeTradePlan({
        symbol: c.symbol,
        side,
        entries: [
          { price: this.cfg.orderType === "limit" ? price : undefined, qtyPct: qtyPct1, type: this.cfg.orderType, ttlMin: this.cfg.entry2TTLMin },
          { price: this.cfg.orderType === "limit" ? price : undefined, qtyPct: qtyPct2, type: this.cfg.orderType, ttlMin: this.cfg.entry2TTLMin },
        ],
        sl: { price: side === "Buy" ? price * (1 - this.cfg.slPctDefault / 100) : price * (1 + this.cfg.slPctDefault / 100), reason: this.cfg.slByStructure ? "structure" : "fixedPct" },
        tps: [
          { price: side === "Buy" ? price * (1 + this.cfg.tp1Pct / 100) : price * (1 - this.cfg.tp1Pct / 100), pct: this.cfg.tp1Pct, closePct: this.cfg.tp1ClosePct },
          { price: side === "Buy" ? price * (1 + this.cfg.tp2Pct / 100) : price * (1 - this.cfg.tp2Pct / 100), pct: this.cfg.tp2Pct, closePct: 100 - this.cfg.tp1ClosePct },
        ],
        timeouts: { triggerTTLMin: this.cfg.triggerTTLMin, flatTTLMin: this.cfg.flatTTLMin, maxHoldHours: this.cfg.maxHoldHours },
        notes: "MVP intent generated",
      });
      if (this.cfg.enableTP3) {
        plan.tps.push({ price: side === "Buy" ? price * (1 + this.cfg.tp3Pct / 100) : price * (1 - this.cfg.tp3Pct / 100), pct: this.cfg.tp3Pct, closePct: 100 });
      }
      this.lastPlan = plan;
      this.lastDecisionTs = Date.now();
      this.counters.signals += 1;
      this.emit("plan", plan);
      this.emit("intent", { mode: this.cfg.mode, plan, note: "Execution adapter hook point" });
      break;
    }
  }
}
