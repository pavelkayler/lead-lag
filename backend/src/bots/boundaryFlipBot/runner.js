import { normalizeConfig, makeInitialStatus } from "./types.js";
import { loadLevels } from "./levels.js";
import { planCycle } from "./planner.js";

export class BoundaryFlipBotRunner {
  constructor({ hub, logger = null, executor, tracker }) {
    this.hub = hub;
    this.logger = logger;
    this.executor = executor;
    this.tracker = tracker;
    this.config = null;
    this.status = makeInitialStatus(normalizeConfig({}));
    this.timer = null;
    this.cycle = null;
  }

  getStatus() { return { ...this.status }; }

  _emit(kind, payload = {}) {
    this.hub.broadcast("boundaryFlipBot", { kind, ts: Date.now(), payload });
  }

  _log(level, msg, data = {}) {
    this.logger?.log("boundary_flip", { level, msg, ...data });
    this._emit("log", { level, msg, data });
  }

  async start(cfg = {}) {
    this.config = normalizeConfig(cfg);
    this.status = makeInitialStatus(this.config);
    this.status.state = "RUNNING";
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
    this._emit("status", this.getStatus());
    return this.getStatus();
  }

  async _startNextCycle(side) {
    const levels = await loadLevels({ rest: this.executor.rest, symbol: this.config.symbol, timeframe: this.config.timeframe });
    const rules = await this.executor.getInstrumentRules(this.config.symbol);
    const plan = planCycle({ side, upper: levels.upper, lower: levels.lower, spreadUsd: this.config.spreadUsd, notionalPerOrder: this.config.notionalPerOrder, tpRoiPct: this.config.tpRoiPct, slRoiPct: this.config.slRoiPct, rules });
    const openOrders = await this.executor.placeEntries({ mode: this.config.mode, symbol: this.config.symbol, side, entries: plan.plannedEntries, cycleId: this.status.cycleId + 1 });
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
    if (!ev?.action) return;
    if (ev.action === "position_opened") {
      const p = this.cycle.position;
      const template = this.cycle.openOrders.find((x) => x.entryPrice === p.entryPrice) || this.cycle.openOrders[0];
      p.tpPrice = template?.tpPrice;
      p.slPrice = template?.slPrice;
      this.status.position = p;
      this._log("info", "Позиция открыта", { cycleId: this.cycle.id, entry: p.entryPrice });
      this._emit("status", this.getStatus());
      return;
    }
    if (ev.action === "close") {
      const p = this.cycle.position;
      await this.executor.closePosition({ mode: this.config.mode, symbol: this.config.symbol, side: p.side, qty: p.qty });
      await this.executor.cancelAllEntries({ mode: this.config.mode, symbol: this.config.symbol });
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
