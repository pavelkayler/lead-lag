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
  blacklist: [],
  useFixedLeaders: false,
  interExchangeArbEnabled: true,
  autoExcludeNoMatchThreshold: 100,
  riskMode: "OFF",
  riskImpulseMargin: 0.4,
  riskQtyMultiplier: 0.5,
  riskCooldownMin: 45,
  maxRiskEntriesPerHour: 1,
  autoTune: {
    enabled: true,
    startTuningAfterMin: 12,
    tuningIntervalSec: 90,
    targetMinTradesPerHour: 1,
    bounds: {
      minCorr: { floor: 0.05, ceil: 0.4 },
      impulseZ: { floor: 1.6, ceil: 4 },
      confirmZ: { floor: 0.05, ceil: 1 },
      edgeMult: { floor: 2.5, ceil: 8 },
      riskImpulseMargin: { floor: 0.1, ceil: 0.8 },
      riskQtyMultiplier: { floor: 0.2, ceil: 1.0 },
      riskModeMax: 3,
    },
  },
};


function normalizeBlacklist(preset = {}) {
  const old = Array.isArray(preset.blacklistSymbols) ? preset.blacklistSymbols : [];
  const next = Array.isArray(preset.blacklist) ? preset.blacklist : old.map((symbol) => ({ symbol, sources: [] }));
  return next
    .map((x) => ({
      symbol: String(x?.symbol || x || "").toUpperCase(),
      sources: Array.isArray(x?.sources) ? x.sources.map((z) => String(z).toUpperCase()) : [],
      reason: x?.reason || undefined,
      excludedAt: Number(x?.excludedAt) || undefined,
      attempts: Number(x?.attempts) || undefined,
    }))
    .filter((x) => x.symbol);
}

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
    this.lastSessionTuneAt = 0;
    this.rejectWindowMs = 10 * 60 * 1000;
    this.rejectWindow = [];
    this.presetsCatalog = clone(DEFAULT_PRESETS);
    this.presetStats = {};
    this.sessionWorkingPreset = new Map();
    this.lastWaitMessage = "";
    this.logDedup = new Map();
    fs.mkdirSync(this.resultsDir, { recursive: true });
    try {
      if (fs.existsSync(this.presetsPath)) {
        const saved = JSON.parse(fs.readFileSync(this.presetsPath, "utf8"));
        if (Array.isArray(saved) && saved.length) this.presetsCatalog = saved.map((p) => ({ ...clone(DEFAULT_PRESET), ...p, blacklist: normalizeBlacklist(p), blacklistSymbols: normalizeBlacklist(p).map((x) => x.symbol) }));
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


  _activeStrategies() {
    if (this.instances.size) return Array.from(this.instances.values()).map((x) => x.strategy).filter(Boolean);
    return this.strategy ? [this.strategy] : [];
  }

  _currentThresholds() {
    const sample = this._activeStrategies()[0];
    const p = sample?.getParams?.() || this.status?.currentPreset || {};
    return {
      minCorr: Number(p.minCorr || 0),
      impulseZ: Number(p.impulseZ || 0),
      edgeMult: Number(p.edgeMult || 0),
      confirmZ: Number(p.minFollowerConfirmZ || 0),
    };
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
      currentThresholds: this._currentThresholds(),
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
    const mergedLeaders = [...picked.filter((x) => !leaders.includes(x)), ...leaders.filter((x) => picked.includes(x))];
    const examples = mergedLeaders.slice(0, 8);
    this.advisor.logEvent("universe", `Universe: picked ${mergedLeaders.length} symbols (cap>${(minMarketCapUsd / 1_000_000).toFixed(0)}M), giants(BTC/ETH/SOL) optional, examples: ${examples.join(", ") || "-"}.`);
    if (mergedLeaders.length >= requestedCount) return mergedLeaders.slice(0, requestedCount);

    const fallback = await this.universe.getTopUSDTPerps({ count: requestedCount, minMarketCapUsd });
    const merged = Array.from(new Set([...mergedLeaders, ...fallback, ...leaders])).slice(0, requestedCount);
    this.advisor.logEvent("universe", `Universe fallback used: доступно ${picked.length}, расширено до ${merged.length}.`);
    return merged;
  }

  _collectRejectReasons() {
    const counters = { corrFail: 0, impulseFail: 0, edgeGateFail: 0, confirmFail: 0, setupExpired: 0, noCandidatePairs: 0 };
    const distances = { corrFail: [], impulseFail: [], edgeGateFail: [], confirmFail: [] };
    let status = "Сканирую пары…";
    const samples = { impulseFail: null, edgeGateFail: null };
    for (const it of this.instances.values()) {
      const rs = it.strategy?.consumeRejectStats?.() || {};
      for (const [k, v] of Object.entries(rs.counters || {})) counters[k] += Number(v || 0);
      for (const [k, arr] of Object.entries(rs.distance || {})) if (Array.isArray(arr) && distances[k]) distances[k].push(...arr.map((x) => Number(x)).filter(Number.isFinite));
      if (rs.runtimeStatus) status = rs.runtimeStatus;
      if (rs.samples?.impulseFail) samples.impulseFail = rs.samples.impulseFail;
      if (rs.samples?.edgeGateFail) samples.edgeGateFail = rs.samples.edgeGateFail;
    }
    if (!this.instances.size) {
      const rs = this.strategy?.consumeRejectStats?.() || {};
      for (const [k, v] of Object.entries(rs.counters || {})) counters[k] += Number(v || 0);
      for (const [k, arr] of Object.entries(rs.distance || {})) if (Array.isArray(arr) && distances[k]) distances[k].push(...arr.map((x) => Number(x)).filter(Number.isFinite));
      if (rs.runtimeStatus) status = rs.runtimeStatus;
      if (rs.samples?.impulseFail) samples.impulseFail = rs.samples.impulseFail;
      if (rs.samples?.edgeGateFail) samples.edgeGateFail = rs.samples.edgeGateFail;
    }
    return { counters, distances, samples, status };
  }

  _shouldLogOnce(key, ttlMs = 4000) {
    const now = Date.now();
    const prev = Number(this.logDedup.get(key) || 0);
    if ((now - prev) < ttlMs) return false;
    this.logDedup.set(key, now);
    return true;
  }

  _hashForLog(input = "") {
    const raw = String(input || "");
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    return String(hash >>> 0);
  }

  _dedupLogKey({ type, symbol = "", source = "", text = "" }) {
    return `${String(type || "GEN").toUpperCase()}:${String(symbol || "-").toUpperCase()}:${String(source || "-").toUpperCase()}:${this._hashForLog(text)}`;
  }

  _emitWaitLog() {
    const now = Date.now();
    if ((now - this.lastWaitLogAt) < 10_000) return;
    if ((now - this.lastNoTradeAt) < 10_000) return;
    const { counters, samples, status } = this._collectRejectReasons();
    this.rejectWindow.push({ ts: now, counters });
    this.rejectWindow = this.rejectWindow.filter((x) => (now - Number(x.ts || 0)) <= this.rejectWindowMs);

    const parts = Object.entries(counters)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} (x${v})`);
    const p = this._currentThresholds();
    const explain = [];
    if (samples?.impulseFail) explain.push(`impulseFail: z=${Number(samples.impulseFail.impulseZNow || 0).toFixed(2)} < ${Number(samples.impulseFail.impulseZThr || 0).toFixed(2)}`);
    if (samples?.edgeGateFail) explain.push(`edgeGateFail: edge=${Number(samples.edgeGateFail.edgeNow || 0).toFixed(3)} < ${Number(samples.edgeGateFail.edgeThr || 0).toFixed(3)}`);
    const message = `WAIT: нет входа. top-3 причины: ${parts.join(", ") || "данные копятся"}. Пороги: minCorr=${Number(p.minCorr || 0).toFixed(3)}, impulseZ=${Number(p.impulseZ || 0).toFixed(2)}, edgeMult=${Number(p.edgeMult || 0).toFixed(2)}, confirmZ=${Number(p.confirmZ || 0).toFixed(2)}. ${explain.join("; ") || "distance-to-pass: n/a"}. ${status}.`;
    const dedupKey = this._dedupLogKey({ type: "WAIT", text: message });
    if ((this.lastWaitMessage !== message && this._shouldLogOnce(dedupKey, 3000)) || (now - this.lastWaitLogAt) >= 10_000) {
      this.advisor.logEvent("wait", message);
      this.lastWaitMessage = message;
    }
    this.lastWaitLogAt = now;
  }


  _runSessionAutoTune(usePresets = [], multiStrategy = false) {
    const cfg = this.status?.autoTuneConfig || {};
    if (!cfg.enabled) return usePresets;
    const now = Date.now();
    if ((now - this.lastSessionTuneAt) < (Number(cfg.tuningIntervalSec || 90) * 1000)) return usePresets;

    const summary = this._aggregateSummary();
    const targets = this.instances.size ? Array.from(this.instances.values()).map((x) => ({ strategy: x.strategy, preset: x.preset })) : [{ strategy: this.strategy, preset: this.status.currentPreset || usePresets[0] }];
    let changed = false;

    const riskLevels = ["OFF", "LOW", "MED", "HIGH"];
    const riskRank = (mode) => Math.max(0, riskLevels.indexOf(String(mode || "OFF").toUpperCase()));
    const modeByRank = (rank) => riskLevels[Math.max(0, Math.min(riskLevels.length - 1, rank))] || "OFF";

    if (Number(summary.trades || 0) <= 0 && this.status?.state === "RUNNING_WAITING") {
      const windowStart = now - this.rejectWindowMs;
      const totals = { corrFail: 0, impulseFail: 0, edgeGateFail: 0, confirmFail: 0, setupExpired: 0, noCandidatePairs: 0 };
      for (const row of this.rejectWindow) {
        if (Number(row.ts || 0) < windowStart) continue;
        for (const [k, v] of Object.entries(row.counters || {})) totals[k] = Number(totals[k] || 0) + Number(v || 0);
      }
      const blocksTotal = Object.values(totals).reduce((a, v) => a + Number(v || 0), 0);
      if (blocksTotal > 0) {
        const impulseShare = Number(totals.impulseFail || 0) / blocksTotal;
        const edgeShare = Number(totals.edgeGateFail || 0) / blocksTotal;

        for (const t of targets) {
          if (changed) break;
          const strategy = t.strategy;
          const preset = t.preset || {};
          if (!strategy?.getParams || !strategy?.setParams) continue;
          const params = strategy.getParams();

          if (impulseShare > 0.6) {
            const floor = Number(cfg?.bounds?.impulseZ?.floor ?? 1.6);
            const step = Number(cfg?.stepImpulseZ ?? 0.2);
            const from = Number(params.impulseZ || 2.5);
            const to = Math.max(floor, from - step);
            if (to < from) {
              strategy.setParams({ impulseZ: Number(to.toFixed(4)) });
              t.preset = { ...preset, impulseZ: Number(to.toFixed(4)) };
              this.advisor.logEvent("auto-tune", `[AUTO-TUNE] impulseZ ${from.toFixed(2)} -> ${to.toFixed(2)} (reason: trades=0, impulseFail ${(impulseShare * 100).toFixed(0)}%)`);
              changed = true;
              break;
            }

            const marginStep = Number(cfg?.stepRiskImpulseMargin ?? 0.1);
            const marginCeil = Number(cfg?.bounds?.riskImpulseMargin?.ceil ?? 0.8);
            const marginFrom = Number(params.riskImpulseMargin ?? preset.riskImpulseMargin ?? 0.4);
            const marginTo = Math.min(marginCeil, marginFrom + marginStep);
            if (marginTo > marginFrom) {
              strategy.setParams({ riskImpulseMargin: Number(marginTo.toFixed(4)) });
              t.preset = { ...preset, riskImpulseMargin: Number(marginTo.toFixed(4)) };
              this.advisor.logEvent("auto-tune", `[AUTO-TUNE] riskImpulseMargin ${marginFrom.toFixed(2)} -> ${marginTo.toFixed(2)} (reason: trades=0, impulseFail ${(impulseShare * 100).toFixed(0)}%, impulseZ at floor)`);
              changed = true;
              break;
            }

            const maxRank = Math.max(0, Math.min(3, Number(cfg?.bounds?.riskModeMax ?? 3)));
            const modeFrom = String(params.riskMode || preset.riskMode || "OFF").toUpperCase();
            const fromRank = riskRank(modeFrom);
            const modeTo = modeByRank(Math.min(maxRank, fromRank + 1));
            if (riskRank(modeTo) > fromRank) {
              strategy.setParams({ riskMode: modeTo });
              t.preset = { ...preset, riskMode: modeTo };
              this.advisor.logEvent("auto-tune", `[AUTO-TUNE] riskMode ${modeFrom} -> ${modeTo} (reason: trades=0, reached floors)`);
              changed = true;
              break;
            }
          }

          if (!changed && edgeShare > 0.4) {
            const floor = Number(cfg?.bounds?.edgeMult?.floor ?? 2.5);
            const step = Number(cfg?.stepEdgeMult ?? 0.5);
            const from = Number(params.edgeMult || 5);
            const to = Math.max(floor, from - step);
            if (to < from) {
              strategy.setParams({ edgeMult: Number(to.toFixed(4)) });
              t.preset = { ...preset, edgeMult: Number(to.toFixed(4)) };
              this.advisor.logEvent("auto-tune", `[AUTO-TUNE] edgeMult ${from.toFixed(2)} -> ${to.toFixed(2)} (reason: trades=0, edgeGateFail ${(edgeShare * 100).toFixed(0)}%)`);
              changed = true;
              break;
            }
          }
        }
      }
    } else if (Number(summary.trades || 0) > 0) {
      const recent = this._allTrades().slice(0, 5);
      const streak = recent.slice(0, 3);
      const losingStreak = streak.length >= 3 && streak.every((t) => Number(t?.pnlUSDT || 0) < 0);
      const recentNet = recent.reduce((acc, t) => acc + Number(t?.pnlUSDT || 0), 0);
      if (losingStreak || recentNet < 0) {
        for (const t of targets) {
          if (changed) break;
          const strategy = t.strategy;
          const preset = t.preset || {};
          if (!strategy?.getParams || !strategy?.setParams) continue;
          const params = strategy.getParams();

          const marginFloor = Number(cfg?.bounds?.riskImpulseMargin?.floor ?? 0.1);
          const marginStep = Number(cfg?.stepRiskImpulseMargin ?? 0.1);
          const marginFrom = Number(params.riskImpulseMargin ?? preset.riskImpulseMargin ?? 0.4);
          const marginTo = Math.max(marginFloor, marginFrom - marginStep);
          if (marginTo < marginFrom) {
            strategy.setParams({ riskImpulseMargin: Number(marginTo.toFixed(4)) });
            t.preset = { ...preset, riskImpulseMargin: Number(marginTo.toFixed(4)) };
            this.advisor.logEvent("auto-tune", `[AUTO-TUNE] riskImpulseMargin ${marginFrom.toFixed(2)} -> ${marginTo.toFixed(2)} (reason: negative pnl series)`);
            changed = true;
            break;
          }

          const modeFrom = String(params.riskMode || preset.riskMode || "OFF").toUpperCase();
          const fromRank = riskRank(modeFrom);
          const modeTo = modeByRank(fromRank - 1);
          if (riskRank(modeTo) < fromRank) {
            strategy.setParams({ riskMode: modeTo });
            t.preset = { ...preset, riskMode: modeTo };
            this.advisor.logEvent("auto-tune", `[AUTO-TUNE] riskMode ${modeFrom} -> ${modeTo} (reason: negative pnl series)`);
            changed = true;
            break;
          }
        }
      }
    }

    this.lastSessionTuneAt = now;
    if (!changed) return usePresets;

    const nextPresets = usePresets.map((p) => ({ ...p }));
    for (let i = 0; i < nextPresets.length; i++) {
      const x = targets.find((t) => t.preset?.name === nextPresets[i].name);
      if (x?.preset) {
        nextPresets[i] = { ...nextPresets[i], ...x.preset };
        this.upsertPreset(nextPresets[i]);
      }
    }

    if (!multiStrategy) this.status.currentPreset = nextPresets[0] || this.status.currentPreset;
    this.status.presets = this.listPresets();
    this._broadcast();
    return nextPresets;
  }

  _persistPresets() {
    try {
      const payload = this.presetsCatalog.map((p) => ({ ...p, blacklist: normalizeBlacklist(p), blacklistSymbols: normalizeBlacklist(p).map((x) => x.symbol) }));
      fs.writeFileSync(this.presetsPath, JSON.stringify(payload, null, 2));
    } catch {}
  }

  listPresets() {
    return clone(this.presetsCatalog.map((p) => ({ ...p, blacklist: normalizeBlacklist(p), blacklistSymbols: normalizeBlacklist(p).map((x) => x.symbol) })));
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
    if (!name) throw new Error("preset.name required (rpc=upsertPreset)");
    const blacklist = normalizeBlacklist(preset);
    const next = { ...clone(DEFAULT_PRESET), ...clone(preset), name, blacklist, blacklistSymbols: blacklist.map((x) => x.symbol) };
    const idx = this.presetsCatalog.findIndex((p) => p.name === name);
    if (idx >= 0) this.presetsCatalog[idx] = next;
    else this.presetsCatalog.push(next);
    this._persistPresets();
    return clone(next);
  }

  updatePreset(name, patch = {}) {
    const key = String(name || "").trim();
    if (!key) throw new Error("updatePreset: name is required in route/argument");
    const idx = this.presetsCatalog.findIndex((p) => p.name === key);
    if (idx < 0) throw new Error(`updatePreset: preset '${key}' not found`);
    const current = this.presetsCatalog[idx];
    const merged = { ...current, ...clone(patch), name: key };
    return this.upsertPreset(merged);
  }

  deletePreset(name) {
    const n = String(name || "").trim();
    this.presetsCatalog = this.presetsCatalog.filter((p) => p.name !== n);
    this._persistPresets();
    return this.listPresets();
  }

  async start({ durationHours = 8, rotateEveryMinutes = 60, symbolsCount = 300, minMarketCapUsd = 10_000_000, presets = null, multiStrategy = false, exploitBest = false, testOnlyPresetName = null, isolatedPresetName = null, useBybit = true, useBinance = true, debugAllowEntryWithoutImpulse = false, debugEntryCooldownMin = 45 } = {}) {
    if (this.running) return this.getStatus();
    this.running = true;
    this.stopRequested = false;
    this.instances.clear();
    this.sessionWorkingPreset.clear();

    const runId = `paper-${Date.now()}`;
    const startedAt = Date.now();
    const hours = Math.max(1, Number(durationHours) || 8);
    const stepMs = Math.max(1, Number(rotateEveryMinutes) || 60) * 60 * 1000;
    const totalMs = hours * 60 * 60 * 1000;
    const steps = Math.max(1, Math.ceil(totalMs / stepMs));
    let usePresets = Array.isArray(presets) && presets.length ? clone(presets) : clone(this.presetsCatalog);

    const singlePresetName = testOnlyPresetName || isolatedPresetName || null;
    if (!multiStrategy && singlePresetName) {
      const one = usePresets.find((p) => p.name === singlePresetName);
      usePresets = one ? [one] : [usePresets[0]];
    }

    if (usePresets.some((preset) => preset?.autoTune?.enabled !== false)) {
      usePresets = usePresets.map((preset) => {
        const cloneName = `${preset.name} @ WORKING`;
        const existing = this.presetsCatalog.find((x) => x.name === cloneName);
        const cloned = existing ? { ...existing } : { ...preset, name: cloneName, blacklist: normalizeBlacklist(preset), blacklistSymbols: normalizeBlacklist(preset).map((x) => x.symbol) };
        this.upsertPreset(cloned);
        this.sessionWorkingPreset.set(preset.name, cloneName);
        this.advisor.logEvent("auto-tune", `Рабочий пресет: ${cloneName}.`);
        return cloned;
      });
    }
    this.advisor.updateOnStart(usePresets);

    let symbols;
    try {
      symbols = await this._pickSymbols({ symbolsCount, minMarketCapUsd: Number(minMarketCapUsd) || 10_000_000 });
    } catch {
      symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"].slice(0, Math.max(1, Number(symbolsCount) || 5));
    }
    this.feed.setSymbols(symbols.slice(0, 100));
    const allowedSources = [useBybit ? "BT" : null, useBinance ? "BNB" : null].filter(Boolean);
    if (!allowedSources.length) throw new Error("At least one source must be enabled: BT or BNB");
    this.logger?.log("paper_test_sources", { useBybit: !!useBybit, useBinance: !!useBinance, message: `Sources: BT=${useBybit ? "ON" : "OFF"}, BNB=${useBinance ? "ON" : "OFF"}` });
    if (usePresets.some((p) => p?.interExchangeArbEnabled) && (!useBybit || !useBinance)) {
      this.logger?.log("paper_test_inter_exchange_missing_sources", { useBybit: !!useBybit, useBinance: !!useBinance, message: "interExchangeArbEnabled: нужны обе биржи (BT+BNB), пары не будут сформированы" });
    }
    if (!this.feed.running) this.feed.start();

    this.broker.reset();
    this.strategy.enable(false);

    if (multiStrategy) {
      for (const preset of usePresets) {
        const broker = new PaperBroker({ logger: this.logger });
        const strategy = new LeadLagPaperStrategy({ feed: this.feed, leadLag: this.leadLag, broker, hub: this.hub, logger: this.logger });
        strategy.setParams({ ...preset, enabled: true, name: preset.name, allowedSources, fixedLeaders: preset?.useFixedLeaders ? ["BTCUSDT","ETHUSDT","SOLUSDT"] : null, debugAllowEntryWithoutImpulse, debugEntryCooldownMin });
        strategy.onAutoExclude = (ev) => this._handleAutoExclude(ev);
        strategy.enable(true);
        strategy.start();
        this.instances.set(preset.name, { broker, strategy, preset });
      }
    } else {
      this.instances.clear();
      this.strategy.setParams({ ...usePresets[0], enabled: true, name: usePresets[0].name, allowedSources, fixedLeaders: usePresets[0]?.useFixedLeaders ? ["BTCUSDT","ETHUSDT","SOLUSDT"] : null, debugAllowEntryWithoutImpulse, debugEntryCooldownMin });
      this.strategy.onAutoExclude = (ev) => this._handleAutoExclude(ev);
      this.strategy.enable(true);
    }

    const activePreset = usePresets[0] || {};
    const presetTune = activePreset.autoTune || {};
    const tuneCfg = {
      enabled: presetTune.enabled !== false,
      startTuningAfterMin: Number(presetTune?.startTuningAfterMin || 12),
      tuningIntervalSec: Number(presetTune?.tuningIntervalSec || 90),
      targetMinTradesPerHour: Number(presetTune?.targetMinTradesPerHour || 1),
      stepImpulseZ: Number(presetTune?.stepImpulseZ || 0.2),
      stepEdgeMult: Number(presetTune?.stepEdgeMult || 0.5),
      stepRiskImpulseMargin: Number(presetTune?.stepRiskImpulseMargin || 0.1),
      bounds: presetTune?.bounds || {},
    };

    this.status = {
      running: true,
      runId,
      startedAt,
      endsAt: null,
      symbols: symbols.slice(0, 100),
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
      sourceConfig: { useBybit: !!useBybit, useBinance: !!useBinance },
      autoTuneConfig: tuneCfg,
    };
    this.advisor.markRunningSettingsHash(usePresets);
    this.lastNoTradeAt = Date.now();
    this.lastWaitLogAt = 0;
    this.rejectWindow = [];
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
            this.strategy.setParams({ ...preset, enabled: true, name: preset.name, allowedSources, fixedLeaders: preset?.useFixedLeaders ? ["BTCUSDT","ETHUSDT","SOLUSDT"] : null, debugAllowEntryWithoutImpulse, debugEntryCooldownMin });
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

          usePresets = this._runSessionAutoTune(usePresets, multiStrategy);

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
            if (!tuneCfg.enabled) this.advisor.logEvent("auto-tune", `AUTO-TUNE пропущен: выключен в пресете preset=${presetName}`);
            else {
              const base = usePresets.find((p) => p.name === presetName);
              if (base) {
                const tuned = { ...base, ...advice.proposedPatch.changes, name: base.name };
                this.upsertPreset(tuned);
                this.advisor.logEvent("auto-tune", `Обновлён рабочий пресет ${tuned.name}: ${Object.entries(advice.proposedPatch.changes).map(([k, v]) => `${k}=${v}`).join(", ")}`);
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


  _handleAutoExclude(ev = {}) {
    const presetName = String(ev.presetName || this.status.currentPreset?.name || "");
    const symbol = String(ev.symbol || "").toUpperCase();
    const source = String(ev.source || "").toUpperCase();
    if (!symbol || !presetName || !source) return;
    if (["BTCUSDT", "ETHUSDT", "SOLUSDT"].includes(symbol)) return;
    const preset = this.presetsCatalog.find((x) => x.name === presetName);
    if (!preset) return;
    const blacklist = normalizeBlacklist(preset);
    const existing = blacklist.find((x) => x.symbol === symbol);
    if (existing) {
      existing.sources = Array.from(new Set([...(existing.sources || []), source]));
      existing.reason = ev.reason || existing.reason;
      existing.excludedAt = Date.now();
      existing.noMatchAsLeaderCount = Number(ev.noMatchAsLeaderCount || existing.noMatchAsLeaderCount || 0);
      existing.noMatchAsFollowerCount = Number(ev.noMatchAsFollowerCount || existing.noMatchAsFollowerCount || 0);
    } else {
      blacklist.push({ symbol, sources: [source], reason: ev.reason, excludedAt: Date.now(), noMatchAsLeaderCount: Number(ev.noMatchAsLeaderCount || 0), noMatchAsFollowerCount: Number(ev.noMatchAsFollowerCount || 0) });
    }
    this.upsertPreset({ ...preset, blacklist, blacklistSymbols: Array.from(new Set(blacklist.map((x) => x.symbol))) });
    const leader = Number(ev.noMatchAsLeaderCount || 0);
    const follower = Number(ev.noMatchAsFollowerCount || 0);
    const threshold = Number(ev.threshold || 100);
    const minNoMatch = Math.min(leader, follower);
    const worstPair = String(ev.worstCounterpart || "-");
    const worstCount = Number(ev.worstCount ?? minNoMatch);
    const msg = `[EXCLUDE] Исключил ${symbol} (${source}): minNoMatchAcrossOthers=${minNoMatch} threshold=${threshold} (пример худшей пары: ${worstPair}=${worstCount})`;
    const dedupKey = this._dedupLogKey({ type: "EXCLUDE", symbol, source, text: `${minNoMatch}:${threshold}:${worstPair}:${worstCount}` });
    if (this._shouldLogOnce(dedupKey, 60_000)) {
      this.advisor.logEvent("exclude", msg);
    }
    this.status.presets = this.listPresets();
    this._broadcast();
  }

  async stop(reason = "user") {
    if (!this.running) return this.getStatus();
    this.stopRequested = true;
    this.status.note = reason;
    this.status.endsAt = Date.now();
    this.advisor.logEvent("stop", "Тест остановлен.");
    this.status.learning = this.advisor.getLearningPayload();
    this._writeLatest(`Stopped: ${reason}`);
    this._broadcast();
    return this.getStatus();
  }
}
