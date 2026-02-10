import fs from "fs";
import path from "path";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function clone(obj) { return JSON.parse(JSON.stringify(obj || {})); }

function nowIso() { return new Date().toISOString(); }

export class PaperTestRunner {
  constructor({ feed, strategy, broker, hub, universe, logger = null } = {}) {
    this.feed = feed;
    this.strategy = strategy;
    this.broker = broker;
    this.hub = hub;
    this.universe = universe;
    this.logger = logger;

    this.running = false;
    this.stopRequested = false;

    this.status = {
      running: false,
      startedAt: null,
      endsAt: null,
      hourIndex: 0,
      currentPreset: null,
      presets: [],
      symbols: [],
      results: [], // per hour
      runId: null,
      note: null,
    };

    this._timer = null;
    this._lastBroadcastTs = 0;

    this.outputDir = path.join(process.cwd(), "recordings");
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
  }

  getStatus() {
    return clone(this.status);
  }

  async start({
    durationHours = 8,
    rotateEveryMinutes = 60,
    symbolsCount = 30,
    minMarketCapUsd = 10_000_000,
    presets = null,
  } = {}) {
    if (this.running) return this.getStatus();

    this.running = true;
    this.stopRequested = false;

    const runId = `paper-${Date.now()}`;
    const startedAt = Date.now();
    const endsAt = startedAt + durationHours * 60 * 60 * 1000;

    const defaultPresets = [
      // 8 presets (1 per hour): from more selective -> less, then different TP/SL
      { name: "S1_selective", qtyUSDT: 100, minCorr: 0.30, stdBars: 240, impulseZ: 3.5, tpSigma: 2.2, slSigma: 1.2, maxHoldBars: 80, cooldownBars: 240 },
      { name: "S2_selective", qtyUSDT: 100, minCorr: 0.28, stdBars: 240, impulseZ: 3.2, tpSigma: 2.1, slSigma: 1.2, maxHoldBars: 90, cooldownBars: 240 },
      { name: "S3_balanced", qtyUSDT: 90,  minCorr: 0.25, stdBars: 180, impulseZ: 3.0, tpSigma: 2.0, slSigma: 1.15, maxHoldBars: 100, cooldownBars: 200 },
      { name: "S4_balanced", qtyUSDT: 90,  minCorr: 0.22, stdBars: 180, impulseZ: 2.8, tpSigma: 1.9, slSigma: 1.10, maxHoldBars: 110, cooldownBars: 200 },
      { name: "S5_active",   qtyUSDT: 80,  minCorr: 0.20, stdBars: 150, impulseZ: 2.7, tpSigma: 1.8, slSigma: 1.05, maxHoldBars: 120, cooldownBars: 160 },
      { name: "S6_active",   qtyUSDT: 80,  minCorr: 0.18, stdBars: 150, impulseZ: 2.6, tpSigma: 1.75, slSigma: 1.05, maxHoldBars: 130, cooldownBars: 160 },
      { name: "S7_aggr",     qtyUSDT: 70,  minCorr: 0.16, stdBars: 120, impulseZ: 2.5, tpSigma: 1.7, slSigma: 1.0,  maxHoldBars: 140, cooldownBars: 120 },
      { name: "S8_aggr",     qtyUSDT: 70,  minCorr: 0.15, stdBars: 120, impulseZ: 2.4, tpSigma: 1.6, slSigma: 1.0,  maxHoldBars: 160, cooldownBars: 120 },
    ];

    const usePresets = Array.isArray(presets) && presets.length ? presets : defaultPresets;

    // Build symbol universe (CMC + Bybit rank, fallback Bybit-only)
    const symbols = await this.universe.getTopUSDTPerps({ count: symbolsCount, minMarketCapUsd });

    // Apply symbols + start feed if needed
    await this.feed.setSymbols(symbols);
    if (!this.feed.running) await this.feed.start();
    // Ensure paper enabled + reset
    this.broker.reset();
    this.strategy.setParams({ enabled: true }); // enable trading
    this.status = {
      running: true,
      startedAt,
      endsAt,
      hourIndex: 0,
      currentPreset: null,
      presets: usePresets.map((p) => ({ ...p })),
      symbols,
      results: [],
      runId,
      note: "Running hourly presets; stop via stopPaperTest",
    };

    this._logToFile(runId, { type: "start", at: nowIso(), symbols, presets: usePresets });

    // Start loop
    this._runLoop({ rotateEveryMinutes, durationHours }).catch((e) => {
      this.logger?.log("paper_test_error", { err: String(e?.message || e) });
      this.status.note = `ERROR: ${String(e?.message || e)}`;
      this.running = false;
      this.status.running = false;
      this._broadcast();
    });

    this._broadcast(true);
    return this.getStatus();
  }

  async stop(reason = "user") {
    if (!this.running) return this.getStatus();
    this.stopRequested = true;
    this.status.note = `Stop requested: ${reason}`;
    this._broadcast(true);
    return this.getStatus();
  }

  async _runLoop({ rotateEveryMinutes, durationHours }) {
    const rotateMs = rotateEveryMinutes * 60 * 1000;
    const totalHours = Math.max(1, Math.floor(durationHours));
    const presets = this.status.presets;

    for (let hour = 0; hour < totalHours; hour++) {
      if (this.stopRequested) break;

      const preset = presets[hour % presets.length];
      this.status.hourIndex = hour;
      this.status.currentPreset = preset;

      // Apply preset
      this.strategy.setParams({
        enabled: true,
        qtyUSDT: preset.qtyUSDT,
        minCorr: preset.minCorr,
        stdBars: preset.stdBars,
        impulseZ: preset.impulseZ,
        tpSigma: preset.tpSigma,
        slSigma: preset.slSigma,
        maxHoldBars: preset.maxHoldBars,
        cooldownBars: preset.cooldownBars,
      });

      // Snapshot stats before
      const before = this.broker.getSummary();

      this._logToFile(this.status.runId, { type: "preset_start", at: nowIso(), hour, preset, before });

      this._broadcast(true);

      // Wait rotate duration, but allow stop
      const t0 = Date.now();
      while (Date.now() - t0 < rotateMs) {
        if (this.stopRequested) break;
        await sleep(1000);
        this._broadcast();
      }

      // Snapshot after
      const after = this.broker.getSummary();
      const delta = {
        pnlUSDT: (after.equityUSDT - before.equityUSDT),
        trades: (after.stats?.trades || 0) - (before.stats?.trades || 0),
        wins: (after.stats?.wins || 0) - (before.stats?.wins || 0),
        losses: (after.stats?.losses || 0) - (before.stats?.losses || 0),
        feesUSDT: (after.stats?.feesUSDT || 0) - (before.stats?.feesUSDT || 0),
      };

      const result = { hour, preset, before, after, delta, endedAt: Date.now() };
      this.status.results.push(result);
      this._logToFile(this.status.runId, { type: "preset_end", at: nowIso(), hour, preset, after, delta });

      this._broadcast(true);
    }

    // Finish
    const final = this.broker.getSummary();
    const summary = {
      runId: this.status.runId,
      startedAt: this.status.startedAt,
      endedAt: Date.now(),
      totalPnlUSDT: final.equityUSDT - final.startingBalanceUSDT,
      trades: final.stats?.trades || 0,
      wins: final.stats?.wins || 0,
      losses: final.stats?.losses || 0,
      feesUSDT: final.stats?.feesUSDT || 0,
      results: this.status.results,
    };

    this._logToFile(this.status.runId, { type: "finish", at: nowIso(), summary });

    this.running = false;
    this.status.running = false;
    this.status.note = this.stopRequested ? "Stopped" : "Completed";
    this.status.final = summary;

    this._broadcast(true);
  }

  _logToFile(runId, obj) {
    try {
      const p = path.join(this.outputDir, `${runId}.jsonl`);
      fs.appendFileSync(p, JSON.stringify(obj) + "\n");
    } catch {}
  }

  _broadcast(force = false) {
    const now = Date.now();
    if (!force && now - this._lastBroadcastTs < 1000) return;
    this._lastBroadcastTs = now;
    try {
      this.hub.broadcast("paperTest", this.getStatus());
    } catch {}
  }
}
