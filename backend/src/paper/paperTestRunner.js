import fs from "fs";
import path from "path";
import { PresetAdvisor } from "./presetAdvisor.js";
import { CoinMarketCapClient } from "../market/coinmarketcap.js";
import { PaperBroker } from "./paperBroker.js";
import { LeadLagPaperStrategy } from "./paperStrategy.js";

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
  entryStrictness: 65,
  blacklistSymbols: [],
};

const DEFAULT_PRESETS = [
  DEFAULT_PRESET,
  { name: "balanced", qtyUSDT: 20, minCorr: 0.2, stdBars: 160, impulseZ: 2.2, tpSigma: 1.4, slSigma: 1.0, maxHoldBars: 28, cooldownBars: 16, entryStrictness: 60 },
  { name: "safe", qtyUSDT: 14, minCorr: 0.26, stdBars: 220, impulseZ: 2.4, tpSigma: 1.2, slSigma: 0.8, maxHoldBars: 32, cooldownBars: 28, entryStrictness: 78 },
];

export class PaperTestRunner {
  constructor({ feed, strategy, broker, hub, universe, logger = null, leadLag = null, rest = null } = {}) {
    this.feed = feed;
    this.strategy = strategy;
    this.broker = broker;
    this.hub = hub;
    this.universe = universe;
    this.logger = logger;
    this.leadLag = leadLag;

    this.running = false;
    this.stopRequested = false;
    this.advisor = new PresetAdvisor();
    this.cmc = new CoinMarketCapClient({ logger: this.logger, bybitRest: rest });
    this.status = { running: false, runId: null, startedAt: null, endsAt: null, note: "Idle", presets: [], presetsByHour: [], topPairs: [], learning: this.advisor.getLearningPayload(), state: "STOPPED" };
    this.resultsDir = path.join(process.cwd(), "results");
    this.latestPath = path.join(this.resultsDir, "latest.json");
    this.presetsPath = path.join(this.resultsDir, "presets.json");
    this.lastKnownTradeCount = 0;
    this.instances = new Map();
    this.lastNoTradeAt = Date.now();
    this.lastWaitLogAt = 0;
    this.lastStrictnessTuneAt = 0;
    this.presetsCatalog = clone(DEFAULT_PRESETS);
    this.presetStats = {};
    fs.mkdirSync(this.resultsDir, { recursive: true });
    try {
      if (fs.existsSync(this.presetsPath)) {
        const saved = JSON.parse(fs.readFileSync(this.presetsPath, "utf8"));
        if (Array.isArray(saved) && saved.length) this.presetsCatalog = saved;
      }
    } catch {}
  }

  getStatus() { return clone(this.status); }

  _allTrades() {
    if (this.instances.size) {
      return Array.from(this.instances.values()).flatMap((x) => x.broker.trades || []);
    }
    return this.broker.trades || [];
  }

  _allBrokers() {
    if (this.instances.size) return Array.from(this.instances.values()).map((x) => x.broker);
    return [this.broker];
  }

  _aggregateSummary() {
    const brokers = this._allBrokers();
    if (!brokers.length) return this.broker.getSummary();
    if (brokers.length === 1) return brokers[0].getSummary();

    const summaries = brokers.map((b) => b.getSummary());
    const first = summaries[0];
    const sum = (key) => summaries.reduce((acc, s) => acc + Number(s[key] || 0), 0);
    const trades = sum("trades");
    const wins = sum("wins");
    const losses = sum("losses");
    return {
      runId: first.runId,
      startedAt: Math.min(...summaries.map((s) => Number(s.startedAt || Date.now()))),
      endsAt: Math.max(...summaries.map((s) => Number(s.endsAt || Date.now()))),
      durationSec: Math.max(...summaries.map((s) => Number(s.durationSec || 0))),
      startingBalanceUSDT: sum("startingBalanceUSDT"),
      equityUSDT: sum("equityUSDT"),
      trades,
      wins,
      losses,
      winRate: trades ? wins / trades : 0,
      grossPnlUSDT: sum("grossPnlUSDT"),
      feesUSDT: sum("feesUSDT"),
      slippageUSDT: sum("slippageUSDT"),
      netPnlUSDT: sum("netPnlUSDT"),
      netPnlBps: first.startingBalanceUSDT > 0 ? (sum("netPnlUSDT") * 10000) / sum("startingBalanceUSDT") : 0,
      profitFactor: 0,
      maxDrawdownUSDT: sum("maxDrawdownUSDT"),
      avgHoldSec: trades ? sum("avgHoldSec") / summaries.length : 0,
      avgR: trades ? sum("avgR") / summaries.length : 0,
      notes: "Multi strategy",
      tradesPreview: this._allTrades().slice(0, 30),
      perPreset: Object.fromEntries(Array.from(this.instances.entries()).map(([name, x]) => [name, x.broker.getSummary()])),
    };
  }

  resetLearning() {
    this.advisor.reset();
    this.status.learning = this.advisor.getLearningPayload();
    this._writeLatest(this.status.note || "Running");
    this._broadcast();
    return this.getStatus();
  }

  _buildTopPairs() {
    const m = new Map();
    for (const t of this._allTrades()) {
      const pair = t.meta?.leader && t.meta?.follower ? `${t.meta.leader}->${t.meta.follower}` : (t.symbol || "-");
      const cur = m.get(pair) || { pair, symbol: t.symbol || pair, tradesCount: 0, netPnlUSDT: 0 };
      cur.tradesCount += 1;
      cur.netPnlUSDT += Number(t.pnlUSDT || 0);
      m.set(pair, cur);
    }
    return [...m.values()].sort((a, b) => b.netPnlUSDT - a.netPnlUSDT).slice(0, 50);
  }

  _deriveRuntimeState() {
    if (!this.running || this.stopRequested) return "STOPPED";
    const hasPos = this._allBrokers().some((b) => !!b.position);
    if (hasPos) return "RUNNING_IN_TRADE";
    return "RUNNING_WAITING";
  }

  _latestPayload(note = "Running") {
    const state = this._deriveRuntimeState();
    this.advisor.setState(state);
    return {
      running: this.running,
      runId: this.status.runId,
      startedAt: this.status.startedAt,
      endsAt: this.status.endsAt,
      summary: this._aggregateSummary(),
      presetsByHour: this.status.presetsByHour || [],
      topPairs: this._buildTopPairs(),
      learning: this.advisor.getLearningPayload(),
      state,
      note,
      presets: this.presetsCatalog,
      presetStats: this.presetStats,
      activePresetName: this.status.currentPreset?.name || null,
      selectedSymbols: this.status.symbols || [],
      trades: this._allTrades().slice(0, 200),
      runningSettingsHash: this.advisor.runningSettingsHash,
      settingsHash: this.advisor.lastSettingsHash,
    };
  }

  _writeLatest(note = "Running") {
    try { fs.writeFileSync(this.latestPath, JSON.stringify(this._latestPayload(note), null, 2)); } catch (e) { this.logger?.log("paper_test_write_latest_err", { error: String(e?.message || e) }); }
  }

  _broadcast() {
    try {
      const payload = this._latestPayload(this.status.note || "Running");
      this.hub.broadcast("paperTest", payload);
    } catch {}
  }

  async _pickSymbols({ symbolsCount, minMarketCapUsd }) {
    const requestedCount = Math.max(3, Number(symbolsCount) || 300);
    const picked = await this.cmc.getUniverseFromRating({ limit: requestedCount, minMarketCapUsd, listingsLimit: 600 });
    const leaders = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const mergedLeaders = [...leaders.filter((x) => picked.includes(x)), ...picked.filter((x) => !leaders.includes(x))];
    const examples = mergedLeaders.slice(0, 8);
    this.advisor.logEvent("universe", `Universe: picked ${mergedLeaders.length} symbols (cap>${(minMarketCapUsd / 1_000_000).toFixed(0)}M), leaders=BTC/ETH/SOL, examples: ${examples.join(", ") || "-"}.`);
    if (mergedLeaders.length >= requestedCount) return mergedLeaders.slice(0, requestedCount);

    const fallback = await this.universe.getTopUSDTPerps({ count: requestedCount, minMarketCapUsd });
    const merged = Array.from(new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", ...mergedLeaders, ...fallback])).slice(0, requestedCount);
    this.advisor.logEvent("universe", `Universe fallback used: доступно ${picked.length}, расширено до ${merged.length}.`);
    return merged;
  }

  _collectRejectReasons() {
    const counters = { corrFail: 0, impulseFail: 0, edgeGateFail: 0, confirmFail: 0, setupExpired: 0, noCandidatePairs: 0 };
    let status = "Сканирую пары…";
    for (const it of this.instances.values()) {
      const rs = it.strategy?.consumeRejectStats?.() || {};
      for (const [k, v] of Object.entries(rs.counters || {})) counters[k] += Number(v || 0);
      if (rs.runtimeStatus) status = rs.runtimeStatus;
    }
    if (!this.instances.size) {
      const rs = this.strategy?.consumeRejectStats?.() || {};
      for (const [k, v] of Object.entries(rs.counters || {})) counters[k] += Number(v || 0);
      if (rs.runtimeStatus) status = rs.runtimeStatus;
    }
    return { counters, status };
  }

  _emitWaitLog() {
    const now = Date.now();
    if ((now - this.lastWaitLogAt) < 10_000) return;
    if ((now - this.lastNoTradeAt) < 10_000) return;
    const { counters, status } = this._collectRejectReasons();
    const parts = Object.entries(counters).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (x${v})`);
    const sample = this.instances.size ? Array.from(this.instances.values())[0]?.strategy : this.strategy;
    const p = sample?.getParams?.() || {};
    this.advisor.logEvent("wait", `WAIT: нет входа. top-3 причины: ${parts.join(", ") || "данные копятся"}. Пороги: minCorr=${Number(p.minCorr || 0).toFixed(3)}, impulseZ=${Number(p.impulseZ || 0).toFixed(2)}, edgeMult=${Number(p.edgeMult || 0).toFixed(2)}, confirmZ=${Number(p.minFollowerConfirmZ || 0).toFixed(2)}. ${status}`);
    if ((now - this.lastStrictnessTuneAt) > 30_000) {
      this.lastStrictnessTuneAt = now;
      const targets = this.instances.size ? Array.from(this.instances.values()) : [{ strategy: this.strategy, preset: this.status.currentPreset || this.presetsCatalog[0] }];
      for (const it of targets) {
        const cur = Number(it.strategy?.getParams?.().entryStrictness ?? it.preset.entryStrictness ?? 65);
        if (cur > 15) {
          const next = Math.max(10, cur - 5);
          const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
          const cloneName = `${it.preset.name} @ ${stamp}`;
          const cloned = { ...it.preset, name: cloneName, entryStrictness: next, blacklistSymbols: [...(it.preset.blacklistSymbols || [])] };
          this.upsertPreset(cloned);
          it.preset = cloned;
          it.strategy.setParams({ ...cloned, name: cloneName, fixedLeaders: ["BTCUSDT", "ETHUSDT", "SOLUSDT"] });
          this.advisor.logEvent("strictness", `Создан новый пресет ${cloneName} из ${it.preset.name}, изменения: {entryStrictness:${cur}->${next}}`);
        }
      }
      this.status.presets = this.listPresets();
      this._broadcast();
    }
    this.lastWaitLogAt = now;
  }


  _persistPresets() {
    try { fs.writeFileSync(this.presetsPath, JSON.stringify(this.presetsCatalog, null, 2)); } catch {}
  }

  listPresets() {
    return clone(this.presetsCatalog);
  }

  _updatePresetStats() {
    const stats = {};
    for (const [name, data] of this.advisor.perPreset.entries()) {
      const netPnlUSDT = Number(data.netPnlUSDT || 0);
      const base = this.presetsCatalog.find((p) => p.name === name);
      const start = Number(base?.startingBalanceUSDT || 1000);
      stats[name] = { netPnlUSDT, roiPct: start > 0 ? (netPnlUSDT / start) * 100 : 0, trades: Number(data.trades || 0) };
    }
    this.presetStats = stats;
  }

  upsertPreset(preset = {}) {
    const name = String(preset?.name || "").trim();
    if (!name) throw new Error("preset.name required");
    const next = { ...clone(DEFAULT_PRESET), ...clone(preset), name };
    const idx = this.presetsCatalog.findIndex((p) => p.name === name);
    if (idx >= 0) this.presetsCatalog[idx] = next;
    else this.presetsCatalog.push(next);
    this._persistPresets();
    return clone(next);
  }

  deletePreset(name) {
    const n = String(name || "").trim();
    this.presetsCatalog = this.presetsCatalog.filter((p) => p.name !== n);
    this._persistPresets();
    return this.listPresets();
  }

  async start({ durationHours = 8, rotateEveryMinutes = 60, symbolsCount = 300, minMarketCapUsd = 10_000_000, presets = null, autoTune = true, multiStrategy = false, exploitBest = false, isolatedPresetName = null } = {}) {
    if (this.running) return this.getStatus();
    this.running = true;
    this.stopRequested = false;
    this.instances.clear();

    const runId = `paper-${Date.now()}`;
    const startedAt = Date.now();
    const hours = Math.max(1, Number(durationHours) || 8);
    const stepMs = Math.max(1, Number(rotateEveryMinutes) || 60) * 60 * 1000;
    const totalMs = hours * 60 * 60 * 1000;
    const steps = Math.max(1, Math.ceil(totalMs / stepMs));
    let usePresets = Array.isArray(presets) && presets.length ? clone(presets) : clone(this.presetsCatalog);

    if (!multiStrategy && isolatedPresetName) {
      const one = usePresets.find((p) => p.name === isolatedPresetName);
      usePresets = one ? [one] : [usePresets[0]];
    }

    this.advisor.updateOnStart(usePresets);

    let symbols;
    try {
      symbols = await this._pickSymbols({ symbolsCount, minMarketCapUsd: Number(minMarketCapUsd) || 10_000_000 });
    } catch {
      symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"].slice(0, Math.max(1, Number(symbolsCount) || 5));
    }
    this.feed.setSymbols(symbols.slice(0, 300));
    if (!this.feed.running) this.feed.start();

    this.broker.reset();
    this.strategy.enable(false);

    if (multiStrategy) {
      for (const preset of usePresets) {
        const broker = new PaperBroker({ logger: this.logger });
        const strategy = new LeadLagPaperStrategy({ feed: this.feed, leadLag: this.leadLag, broker, hub: this.hub, logger: this.logger });
        strategy.setParams({ ...preset, enabled: true, name: preset.name, fixedLeaders: ["BTCUSDT","ETHUSDT","SOLUSDT"] });
        strategy.enable(true);
        strategy.start();
        this.instances.set(preset.name, { broker, strategy, preset });
      }
    } else {
      this.instances.clear();
      this.strategy.setParams({ ...usePresets[0], enabled: true, name: usePresets[0].name, fixedLeaders: ["BTCUSDT","ETHUSDT","SOLUSDT"] });
      this.strategy.enable(true);
    }

    this.status = {
      running: true,
      runId,
      startedAt,
      endsAt: null,
      symbols: symbols.slice(0, 300),
      presets: usePresets,
      currentPreset: usePresets[0],
      presetsByHour: [],
      topPairs: [],
      note: "Running",
      learning: this.advisor.getLearningPayload(),
      state: "RUNNING_WAITING",
      exploitMode: false,
      activePresets: usePresets.map((p) => p.name),
      multiStrategy: !!multiStrategy,
    };
    this.advisor.markRunningSettingsHash(usePresets);
    this.lastNoTradeAt = Date.now();
    this.lastWaitLogAt = 0;
    this._writeLatest("Running");
    this._broadcast();

    (async () => {
      try {
        let selectedBest = null;
        for (let i = 0; i < steps; i++) {
          if (this.stopRequested) break;

          if (!multiStrategy) {
            const preset = usePresets[i % usePresets.length];
            this.status.currentPreset = preset;
            this.strategy.setParams({ ...preset, enabled: true, name: preset.name, fixedLeaders: ["BTCUSDT","ETHUSDT","SOLUSDT"] });
          }

          const before = this._aggregateSummary();
          const t0 = Date.now();
          while (Date.now() - t0 < stepMs) {
            if (this.stopRequested) break;
            this.status.state = this._deriveRuntimeState();
            this._emitWaitLog();
            this._writeLatest("Running");
            await sleep(1000);
          }

          const after = this._aggregateSummary();
          const segmentStats = {
            trades: (after.trades || 0) - (before.trades || 0),
            wins: (after.wins || 0) - (before.wins || 0),
            losses: (after.losses || 0) - (before.losses || 0),
            netPnlUSDT: (after.netPnlUSDT || 0) - (before.netPnlUSDT || 0),
            feesUSDT: (after.feesUSDT || 0) - (before.feesUSDT || 0),
            slippageUSDT: (after.slippageUSDT || 0) - (before.slippageUSDT || 0),
          };
          if (segmentStats.trades === 0) this.advisor.logEvent("segment", `INFO: Segment ${i + 1} завершён без сделок.`);
          else this.lastNoTradeAt = Date.now();

          const presetName = this.status.currentPreset?.name || (usePresets[0]?.name || "preset");
          this.status.presetsByHour.push({ hour: i + 1, segment: i + 1, preset: presetName, ...segmentStats, winRate: segmentStats.trades ? segmentStats.wins / segmentStats.trades : 0 });
          const advice = this.advisor.updateOnSegment({ name: presetName }, segmentStats, i + 1);

          if (advice?.proposedPatch && Object.keys(advice.proposedPatch?.changes || {}).length) {
            if (!autoTune) this.advisor.logEvent("auto-tune", `AUTO-TUNE пропущен: autoTune=false preset=${presetName}`);
            else {
              const base = usePresets.find((p) => p.name === presetName);
              if (base) {
                const stamp = new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 16);
                const cloneName = `${presetName} @ ${stamp}`;
                const tuned = { ...base, ...advice.proposedPatch.changes, name: cloneName };
                this.upsertPreset(tuned);
                this.advisor.logEvent("auto-tune", `Создан новый пресет ${cloneName} (из ${presetName}) изменения: ${Object.entries(advice.proposedPatch.changes).map(([k, v]) => `${k}=${v}`).join(", ")}`);
                if (!multiStrategy && exploitBest) {
                  usePresets = [tuned];
                  this.status.currentPreset = tuned;
                  this.strategy.setParams({ ...tuned, enabled: true, name: tuned.name });
                }
              }
            }
          } else {
            this.advisor.logEvent("auto-tune", `AUTO-TUNE пропущен: нет предложений (мало данных/нет статистики/не выполнены условия) preset=${presetName}`);
          }

          if (exploitBest && !selectedBest && this.advisor.shouldExploitBestPreset({ minTrades: 30, minSegments: 6 })) {
            selectedBest = this.advisor.bestPresetName;
            const best = usePresets.find((p) => p.name === selectedBest);
            if (best && !multiStrategy) {
              usePresets = [best];
              this.status.exploitMode = true;
              this.status.activePresets = [best.name];
              this.advisor.logEvent("exploit", `Выбран лучший пресет: ${best.name}.`);
            }
          }

          this.status.learning = this.advisor.getLearningPayload();
          this._updatePresetStats();
          this.status.topPairs = this._buildTopPairs();
          this.status.state = this._deriveRuntimeState();
          this._writeLatest("Running");
          this._broadcast();
        }
      } catch (e) {
        this.status.note = `Ошибка: ${String(e?.message || e)}`;
      } finally {
        for (const it of this.instances.values()) it.strategy.stop();
        this.instances.clear();
        this.running = false;
        this.status.running = false;
        this.status.endsAt = Date.now();
        this.status.topPairs = this._buildTopPairs();
        this.status.learning = this.advisor.getLearningPayload();
        this._updatePresetStats();
        this.status.state = "STOPPED";
        this.advisor.setState("STOPPED");
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
    this.advisor.logEvent("stop", "Тест остановлен.");
    this.status.learning = this.advisor.getLearningPayload();
    this._writeLatest(`Stopped: ${reason}`);
    this._broadcast();
    return this.getStatus();
  }
}
