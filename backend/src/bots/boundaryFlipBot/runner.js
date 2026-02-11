import { normalizeConfig, makeInitialStatus } from "./types.js";
import { loadLevels } from "./levels.js";
import { planCycle } from "./planner.js";

export class BoundaryFlipBotRunner {
  constructor({ hub, logger = null, fileLogger = null, executor, tracker, feed = null }) {
    this.hub = hub;
    this.logger = logger;
    this.fileLogger = fileLogger;
    this.executor = executor;
    this.tracker = tracker;
    this.feed = feed;
    this.config = null;
    this.status = makeInitialStatus(normalizeConfig({}));
    this.timer = null;
    this.cycle = null;
    this.logDedup = new Map();
  }

  getStatus() { return { ...this.status }; }

  _emit(kind, payload = {}) {
    this.hub.broadcast("boundaryFlipBot", { kind, ts: Date.now(), payload });
  }

  _dedupKey(msg, data = {}) {
    return `${String(msg || "")}::${String(data?.code || "")}`;
  }

  _log(level, msg, data = {}, { dedupTtlMs = 0 } = {}) {
    const dedupKey = this._dedupKey(msg, data);
    if (dedupTtlMs > 0) {
      const now = Date.now();
      const last = Number(this.logDedup.get(dedupKey) || 0);
      if ((now - last) < dedupTtlMs) return;
      this.logDedup.set(dedupKey, now);
    }

    const evt = { level, msg, mode: this.config?.mode || this.status?.mode, symbol: this.config?.symbol || this.status?.symbol, cycleId: this.status?.cycleId || 0, side: this.status?.currentSide || null, ...data };
    this.logger?.log("boundary_flip", evt);
    this.fileLogger?.log("boundary_flip", evt);
    this._emit("log", evt);
  }

  async start(cfg = {}) {
    this.config = normalizeConfig(cfg);
    this.status = makeInitialStatus(this.config);
    this.status.state = "RUNNING";
    this.status.startedAt = Date.now();
    this.status.updatedAt = Date.now();
    this._log("info", "Boundary Flip bot started", { config: { ...this.config, apiKey: undefined, apiSecret: undefined } });
    this._emit("status", this.getStatus());
    await this._startNextCycle(this.config.firstSide);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this._loop().catch((e) => this._onError(e)), 1500);
    this.timer.unref?.();
    return this.getStatus();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.state = "STOPPED";
    this.status.updatedAt = Date.now();
    this._log("info", "Boundary Flip bot stopped", { reason: "manual_stop" });
    this._emit("status", this.getStatus());
    return this.getStatus();
  }

  async _startNextCycle(side) {
    const levels = await loadLevels({ rest: this.executor.rest, feed: this.feed, symbol: this.config.symbol, timeframe: this.config.timeframe, mode: this.config.mode });
    const rules = await this.executor.getInstrumentRules(this.config.symbol, this.config.mode);
    const plan = planCycle({ side, upper: levels.upper, lower: levels.lower, spreadUsd: this.config.spreadUsd, notionalPerOrder: this.config.notionalPerOrder, tpRoiPct: this.config.tpRoiPct, slRoiPct: this.config.slRoiPct, rules });
    this._log("info", "Cycle boundaries and plan prepared", { side, upper: levels.upper, lower: levels.lower, boundaryPrice: plan.boundaryPrice, entries: plan.plannedEntries });

    const openOrders = await this.executor.placeEntries({ mode: this.config.mode, symbol: this.config.symbol, side, entries: plan.plannedEntries, cycleId: this.status.cycleId + 1 });
    this._log("info", "Entries placed", { side, entries: openOrders });

    this.status.cycleId += 1;
    this.status.currentSide = side;
    this.status.upper = levels.upper;
    this.status.lower = levels.lower;
    this.status.boundaryPrice = plan.boundaryPrice;
    this.status.plannedEntries = plan.plannedEntries;
    this.status.openOrders = openOrders;
    this.status.position = null;
    this.status.updatedAt = Date.now();
    this.cycle = { id: this.status.cycleId, side, levels, openOrders, position: null };
    this._emit("levels", { upper: levels.upper, lower: levels.lower });
    this._emit("cycle", { event: "cycleStarted", cycleId: this.status.cycleId, side });
    this._emit("status", this.getStatus());
  }

  async _loop() {
    if (!this.cycle || this.status.state !== "RUNNING") return;
    const ev = await this.tracker.evaluate({ config: this.config, cycle: this.cycle, levels: this.cycle.levels });
    if (!ev?.action) {
      if (ev?.reason) this._log("debug", `WAIT: ${ev.reason}`, { code: ev.reason }, { dedupTtlMs: 6000 });
      return;
    }
    if (ev.action === "position_opened") {
      const p = this.cycle.position;
      this.status.position = p;
      this._log("info", "Позиция открыта", { cycleId: this.cycle.id, avgEntry: p.avgEntry, qty: p.qty, tpPrice: p.tpPrice, slPrice: p.slPrice });
      this._emit("status", this.getStatus());
      return;
    }
    if (ev.action === "close") {
      const p = this.cycle.position;
      await this.executor.closePosition({ mode: this.config.mode, symbol: this.config.symbol, side: p.side, qty: p.qty });
      await this.executor.cancelAllEntries({ mode: this.config.mode, symbol: this.config.symbol });
      this._log("info", "Cycle close executed", { reason: ev.reason, pnlPct: ev.pnlPct, pnlUSDT: ev.pnlUSDT ?? null, avgEntry: p.avgEntry, closeMark: ev.mark });
      if (ev.reason === "EARLY" && ev.earlyMeta) {
        const m = ev.earlyMeta;
        this._log(
          "info",
          `[EARLY] close near TP: roi=${Number(ev.pnlPct || 0).toFixed(3)}%, tp=${m.tpPrice}, nearStart=${m.nearStartPrice}, peak=${m.peakPrice}, pullback=${m.pullbackPctFromPeak}%, candleBodyPct=${m.candleBodyPct}, bodyToRange=${m.bodyToRange}`,
          { cycleId: this.cycle.id, ...m },
        );
      }
      this.status.lastCycleReason = ev.reason;
      this._emit("cycle", { event: "cycleEnded", cycleId: this.cycle.id, reason: ev.reason });
      const next = this.cycle.side === "SHORT" ? "LONG" : "SHORT";
      await this._startNextCycle(next);
    }
  }

  _onError(e) {
    this.status.lastError = String(e?.message || e);
    this._log("error", "Boundary Flip error", { error: this.status.lastError });
    this._emit("status", this.getStatus());
  }
}
