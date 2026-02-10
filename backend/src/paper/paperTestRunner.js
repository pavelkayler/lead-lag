import fs from "fs";
import path from "path";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function clone(obj) { return JSON.parse(JSON.stringify(obj || {})); }

const DEFAULT_PRESET = {
  name: "profit-first",
  qtyUSDT: 25,
  minCorr: 0.15,
  stdBars: 120,
  impulseZ: 2.5,
  tpSigma: 1.5,
  slSigma: 1.0,
  maxHoldBars: 20,
  cooldownBars: 20,
};

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
    this.status = { running: false, runId: null, startedAt: null, endsAt: null, note: "Idle", presets: [], presetsByHour: [], topPairs: [] };
    this.resultsDir = path.join(process.cwd(), "results");
    this.latestPath = path.join(this.resultsDir, "latest.json");
    fs.mkdirSync(this.resultsDir, { recursive: true });
  }

  getStatus() { return clone(this.status); }

  _buildTopPairs() {
    const m = new Map();
    for (const t of this.broker.trades || []) {
      const pair = t.meta?.leader && t.meta?.follower ? `${t.meta.leader}->${t.meta.follower}` : (t.symbol || "-");
      const key = pair;
      const cur = m.get(key) || { pair, symbol: t.symbol || pair, tradesCount: 0, netPnlUSDT: 0 };
      cur.tradesCount += 1;
      cur.netPnlUSDT += Number(t.pnlUSDT || 0);
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.netPnlUSDT - a.netPnlUSDT).slice(0, 50);
  }

  _latestPayload(note = "Running") {
    return {
      running: this.running,
      runId: this.status.runId,
      startedAt: this.status.startedAt,
      endsAt: this.status.endsAt,
      summary: this.broker.getSummary(),
      presetsByHour: this.status.presetsByHour || [],
      topPairs: this._buildTopPairs(),
      note,
    };
  }

  _writeLatest(note = "Running") {
    try { fs.writeFileSync(this.latestPath, JSON.stringify(this._latestPayload(note), null, 2)); } catch (e) { this.logger?.log("paper_test_write_latest_err", { error: String(e?.message || e) }); }
  }

  _broadcast() {
    try { this.hub.broadcast("paperTest", this.getStatus()); } catch {}
  }

  async start({ durationHours = 8, rotateEveryMinutes = 60, symbolsCount = 30, minMarketCapUsd = 10_000_000, presets = null } = {}) {
    if (this.running) return this.getStatus();
    this.running = true;
    this.stopRequested = false;

    const runId = `paper-${Date.now()}`;
    const startedAt = Date.now();
    const hours = Math.max(1, Number(durationHours) || 8);
    const rotateMs = Math.max(1, Number(rotateEveryMinutes) || 60) * 60 * 1000;
    const usePresets = Array.isArray(presets) && presets.length ? presets : [DEFAULT_PRESET];

    let symbols;
    try {
      symbols = await this.universe.getTopUSDTPerps({ count: Number(symbolsCount) || 30, minMarketCapUsd: Number(minMarketCapUsd) || 10_000_000 });
    } catch (e) {
      symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"].slice(0, Math.max(1, Number(symbolsCount) || 5));
      this.logger?.log("paper_test_universe_fallback", { error: String(e?.message || e), symbols });
    }
    this.feed.setSymbols(symbols);
    if (!this.feed.running) this.feed.start();

    this.broker.reset();
    this.strategy.enable(true);

    this.status = { running: true, runId, startedAt, endsAt: null, symbols, presets: usePresets, currentPreset: usePresets[0], presetsByHour: [], topPairs: [], note: "Running" };
    this._writeLatest("Running");
    this._broadcast();

    (async () => {
      try {
        for (let h = 0; h < hours; h++) {
          if (this.stopRequested) break;
          const preset = usePresets[h % usePresets.length];
          this.status.currentPreset = preset;

          const before = this.broker.getSummary();
          this.strategy.setParams({ ...preset, enabled: true });
          const t0 = Date.now();
          while (Date.now() - t0 < rotateMs) {
            if (this.stopRequested) break;
            await sleep(1000);
          }
          const after = this.broker.getSummary();
          const trades = (after.trades || 0) - (before.trades || 0);
          const wins = (after.wins || 0) - (before.wins || 0);
          const losses = (after.losses || 0) - (before.losses || 0);
          const netPnlUSDT = (after.netPnlUSDT || 0) - (before.netPnlUSDT || 0);
          const feesUSDT = (after.feesUSDT || 0) - (before.feesUSDT || 0);
          const slippageUSDT = (after.slippageUSDT || 0) - (before.slippageUSDT || 0);

          this.status.presetsByHour.push({
            hour: h + 1,
            preset: preset.name || `preset-${h + 1}`,
            trades,
            wins,
            losses,
            winRate: trades ? wins / trades : 0,
            netPnlUSDT,
            feesUSDT,
            slippageUSDT,
          });

          this.status.topPairs = this._buildTopPairs();
          this._writeLatest("Running");
          this._broadcast();
        }
      } catch (e) {
        this.logger?.log("paper_test_run_err", { error: String(e?.message || e) });
        this.status.note = `Ошибка: ${String(e?.message || e)}`;
      } finally {
        this.running = false;
        this.status.running = false;
        this.status.endsAt = Date.now();
        this.status.topPairs = this._buildTopPairs();
        const note = this.stopRequested ? `Stopped: ${this.status.note || "user"}` : "Completed";
        this.status.note = note;
        this._writeLatest(note);
        this._broadcast();
      }
    })();

    return this.getStatus();
  }

  async stop(reason = "user") {
    if (!this.running) return this.getStatus();
    this.stopRequested = true;
    this.status.note = reason;
    this._writeLatest(`Stopped: ${reason}`);
    this._broadcast();
    return this.getStatus();
  }
}
