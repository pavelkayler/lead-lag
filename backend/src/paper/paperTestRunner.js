import fs from "fs";
import path from "path";
import { PresetAdvisor } from "./presetAdvisor.js";
import { CoinMarketCapClient } from "../market/coinmarketcap.js";

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
    this.advisor = new PresetAdvisor();
    this.cmc = new CoinMarketCapClient({ logger: this.logger });
    this.status = { running: false, runId: null, startedAt: null, endsAt: null, note: "Idle", presets: [], presetsByHour: [], topPairs: [], learning: this.advisor.getLearningPayload(), state: "STOPPED" };
    this.resultsDir = path.join(process.cwd(), "results");
    this.latestPath = path.join(this.resultsDir, "latest.json");
    this.lastKnownTradeCount = 0;
    fs.mkdirSync(this.resultsDir, { recursive: true });
  }

  getStatus() { return clone(this.status); }

  resetLearning() {
    this.advisor.reset();
    this.status.learning = this.advisor.getLearningPayload();
    this._writeLatest(this.status.note || "Running");
    this._broadcast();
    return this.getStatus();
  }

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

  _deriveRuntimeState() {
    if (!this.running) return "STOPPED";
    if (this.broker.position) return "RUNNING_IN_TRADE";
    const recentTrade = this.broker.trades?.[0];
    if (recentTrade && (Date.now() - Number(recentTrade.ts || 0)) < 30_000) return "RUNNING_IN_TRADE";
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
      summary: this.broker.getSummary(),
      presetsByHour: this.status.presetsByHour || [],
      topPairs: this._buildTopPairs(),
      learning: this.advisor.getLearningPayload(),
      state,
      note,
      presets: this.status.presets || [],
      activePresetName: this.status.currentPreset?.name || null,
      selectedSymbols: this.status.symbols || [],
    };
  }

  _writeLatest(note = "Running") {
    try { fs.writeFileSync(this.latestPath, JSON.stringify(this._latestPayload(note), null, 2)); } catch (e) { this.logger?.log("paper_test_write_latest_err", { error: String(e?.message || e) }); }
  }

  _broadcast() {
    try {
      const payload = this.getStatus();
      payload.state = this._deriveRuntimeState();
      payload.learning = this.advisor.getLearningPayload();
      this.hub.broadcast("paperTest", payload);
    } catch {}
  }

  _applyPatchToPreset(presets, patch) {
    const idx = presets.findIndex((p) => p.name === patch?.presetName);
    if (idx < 0) return { presets, logs: [] };
    const before = presets[idx];
    const next = { ...before, ...patch.changes };
    const logs = [];
    for (const [k, v] of Object.entries(patch.changes || {})) {
      logs.push(`Автотюнинг применён: preset=${patch.presetName} ${k}: ${before[k]}→${v}`);
    }
    const out = [...presets];
    out[idx] = next;
    return { presets: out, logs };
  }

  async _pickSymbols({ symbolsCount, minMarketCapUsd }) {
    const requestedCount = Math.max(1, Number(symbolsCount) || 30);
    const candidates = await this.universe.getTopUSDTPerps({ count: Math.max(60, requestedCount * 3), minMarketCapUsd });
    const byBase = [];
    for (const sym of candidates || []) {
      const s = String(sym || "").toUpperCase();
      if (!s.endsWith("USDT")) continue;
      const base = s.slice(0, -4);
      byBase.push({ symbol: s, base, sourceIndex: byBase.length });
    }

    let capMap = null;
    try {
      capMap = await this.cmc.getMarketCapsMap({ limit: 200 });
    } catch (e) {
      this.logger?.log("paper_test_cmc_fallback", { error: String(e?.message || e) });
    }

    let filtered = byBase;
    if (capMap) {
      filtered = byBase
        .map((item) => ({ ...item, marketCapUsd: Number(capMap.get(item.base)) }))
        .filter((item) => Number.isFinite(item.marketCapUsd) && item.marketCapUsd >= minMarketCapUsd)
        .sort((a, b) => (b.marketCapUsd - a.marketCapUsd) || (a.sourceIndex - b.sourceIndex));
    }

    const picked = filtered.slice(0, requestedCount).map((x) => x.symbol);
    const examples = picked.slice(0, 8);
    this.logger?.log("paper_test_universe", { requestedCount, minMarketCapUsd, picked: picked.length, examples, usedCapFilter: !!capMap });
    this.advisor.logEvent("universe", `Universe: picked ${picked.length} symbols (cap>${(minMarketCapUsd / 1_000_000).toFixed(0)}M), examples: ${examples.join(", ") || "-"}.`);

    if (picked.length >= requestedCount) return picked;

    const fallback = Array.from(new Set([...picked, ...byBase.map((x) => x.symbol)])).slice(0, requestedCount);
    if (fallback.length !== picked.length) {
      this.advisor.logEvent("universe", `Universe fallback used: доступно ${picked.length} с cap-фильтром, расширено до ${fallback.length}.`);
    }
    return fallback;
  }

  async start({ durationHours = 8, rotateEveryMinutes = 60, symbolsCount = 30, minMarketCapUsd = 10_000_000, presets = null, autoTune = true } = {}) {
    if (this.running) return this.getStatus();
    this.running = true;
    this.stopRequested = false;

    const runId = `paper-${Date.now()}`;
    const startedAt = Date.now();
    const hours = Math.max(1, Number(durationHours) || 8);
    const stepMs = Math.max(1, Number(rotateEveryMinutes) || 60) * 60 * 1000;
    const totalMs = hours * 60 * 60 * 1000;
    const steps = Math.max(1, Math.ceil(totalMs / stepMs));
    let usePresets = Array.isArray(presets) && presets.length ? clone(presets) : [clone(DEFAULT_PRESET)];

    this.advisor.logEvent("start", "Тест запущен.");
    this.advisor.updateOnStart(usePresets);

    let symbols;
    try {
      symbols = await this._pickSymbols({ symbolsCount, minMarketCapUsd: Number(minMarketCapUsd) || 10_000_000 });
    } catch (e) {
      symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"].slice(0, Math.max(1, Number(symbolsCount) || 5));
      this.logger?.log("paper_test_universe_fallback", { error: String(e?.message || e), symbols });
      this.advisor.logEvent("universe", `Universe fallback: picked ${symbols.length} symbols.`);
    }
    this.feed.setSymbols(symbols.slice(0, 30));
    if (!this.feed.running) this.feed.start();

    this.broker.reset();
    this.lastKnownTradeCount = 0;
    this.strategy.enable(true);

    this.status = {
      running: true,
      runId,
      startedAt,
      endsAt: null,
      symbols: symbols.slice(0, 30),
      presets: usePresets,
      currentPreset: usePresets[0],
      presetsByHour: [],
      topPairs: [],
      note: "Running",
      learning: this.advisor.getLearningPayload(),
      state: "RUNNING_WAITING",
      exploitMode: false,
      activePresets: usePresets.map((p) => p.name),
    };
    this._writeLatest("Running");
    this._broadcast();

    (async () => {
      try {
        let selectedBest = null;
        for (let i = 0; i < steps; i++) {
          if (this.stopRequested) break;

          if (!selectedBest && this.advisor.shouldExploitBestPreset({ minTrades: 30, minSegments: 6 })) {
            selectedBest = this.advisor.bestPresetName;
            const bestPreset = usePresets.find((p) => p.name === selectedBest);
            if (bestPreset) {
              usePresets = [bestPreset];
              this.status.exploitMode = true;
              this.status.activePresets = [bestPreset.name];
              this.advisor.logEvent("exploit", `Достаточно данных, выбран лучший пресет: ${bestPreset.name}. Переходим к использованию только его.`);
            }
          }

          const preset = usePresets[i % usePresets.length];
          this.status.currentPreset = preset;
          this.status.presets = usePresets;

          const before = this.broker.getSummary();
          this.strategy.setParams({ ...preset, enabled: true });
          const t0 = Date.now();
          while (Date.now() - t0 < stepMs) {
            if (this.stopRequested) break;
            const state = this._deriveRuntimeState();
            this.status.state = state;
            this.advisor.setState(state);
            this._writeLatest("Running");
            await sleep(1000);
          }
          const after = this.broker.getSummary();
          const segmentStats = {
            trades: (after.trades || 0) - (before.trades || 0),
            wins: (after.wins || 0) - (before.wins || 0),
            losses: (after.losses || 0) - (before.losses || 0),
            netPnlUSDT: (after.netPnlUSDT || 0) - (before.netPnlUSDT || 0),
            feesUSDT: (after.feesUSDT || 0) - (before.feesUSDT || 0),
            slippageUSDT: (after.slippageUSDT || 0) - (before.slippageUSDT || 0),
          };

          for (let idx = this.lastKnownTradeCount; idx < (this.broker.trades || []).length; idx++) {
            const ts = this.broker.trades[idx]?.ts;
            this.advisor.recordTrade(ts);
          }
          this.lastKnownTradeCount = (this.broker.trades || []).length;

          this.status.presetsByHour.push({
            hour: i + 1,
            segment: i + 1,
            preset: preset.name || `preset-${i + 1}`,
            ...segmentStats,
            winRate: segmentStats.trades ? segmentStats.wins / segmentStats.trades : 0,
          });

          const advice = this.advisor.updateOnSegment(preset, segmentStats, i + 1);

          if (advice?.proposedPatch && Object.keys(advice.proposedPatch?.changes || {}).length) {
            const minSegmentGap = 3;
            const presetName = advice.proposedPatch.presetName;
            const tradesEnough = segmentStats.trades >= 10;
            const canTuneNow = this.advisor.canAutoTune({ presetName, currentSegment: i + 1, minSegmentGap });

            if (autoTune && tradesEnough && canTuneNow) {
              const patchRes = this._applyPatchToPreset(usePresets, advice.proposedPatch);
              usePresets = patchRes.presets;
              this.status.presets = usePresets;
              for (const line of patchRes.logs) this.advisor.logEvent("auto-tune", line);
              this.advisor.markAutoTuneApplied({ presetName, segment: i + 1 });
            } else {
              let reason = "unknown";
              if (!autoTune) reason = "autoTune=false";
              else if (!tradesEnough) reason = `trades<10 (trades=${segmentStats.trades})`;
              else if (!canTuneNow) {
                const lastSegment = Number(this.advisor.lastTuneSegmentByPreset.get(presetName) || 0);
                const waitSegments = Math.max(0, minSegmentGap - ((i + 1) - lastSegment));
                reason = `minSegmentGap not met (ожидаем ещё ${waitSegments} сегм.)`;
              }
              this.advisor.logEvent("auto-tune", `Автотюнинг пропущен: причина=${reason} preset=${presetName}`);
            }
          } else {
            this.advisor.logEvent("auto-tune", `Автотюнинг пропущен: причина=proposedPatch отсутствует/пустой preset=${preset.name || "preset"}`);
          }

          this.status.learning = this.advisor.getLearningPayload();
          this.status.topPairs = this._buildTopPairs();
          this.status.state = this._deriveRuntimeState();
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
        this.status.learning = this.advisor.getLearningPayload();
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
