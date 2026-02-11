function stableStringify(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function formatSec(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "неизвестно (мало данных)";
  return `~${sec.toFixed(1)} сек`;
}

export class PresetAdvisor {
  constructor({ maxLog = 400 } = {}) {
    this.maxLog = maxLog;
    this.lastPresetsHash = null;
    this.lastSettingsHash = null;
    this.runningSettingsHash = null;
    this.statusText = "нужно тестировать текущие настройки";
    this.totalTrades = 0;
    this.totalSegments = 0;
    this.perPreset = new Map();
    this.log = [];
    this.bestPresetName = null;
    this.tradeTimestamps = [];
    this.currentState = "STOPPED";
    this.lastEtaSec = null;
    this.lastTuneSegmentByPreset = new Map();
  }

  _pushLog(line) {
    this.log.push(`${new Date().toLocaleTimeString("ru-RU")}: ${line}`);
    if (this.log.length > this.maxLog) this.log = this.log.slice(-this.maxLog);
  }

  logEvent(type, msg) {
    this._pushLog(`[${String(type || "event").toUpperCase()}] ${msg}`);
  }

  setState(state) {
    const next = String(state || "STOPPED");
    if (this.currentState !== next) {
      this.currentState = next;
      this._pushLog(`Состояние: ${next}`);
    } else {
      this.currentState = next;
    }
  }

  updateOnStart(presets = []) {
    const hash = stableStringify(presets);
    this.lastSettingsHash = hash;
    if (this.runningSettingsHash && this.runningSettingsHash === hash) {
      this.statusText = "тест с новыми настройками запущен";
    } else if (this.lastPresetsHash && hash !== this.lastPresetsHash) {
      this.statusText = "выставлены новые настройки, нужны тесты";
    } else if (!this.lastPresetsHash) {
      this.statusText = "нужно тестировать текущие настройки";
      this.logEvent("start", "Первичный запуск тестирования пресетов.");
    }
    this.lastPresetsHash = hash;
  }

  markRunningSettingsHash(presets = []) {
    this.runningSettingsHash = stableStringify(presets);
    if (this.runningSettingsHash === this.lastSettingsHash) {
      this.statusText = "тест с новыми настройками запущен";
      this.logEvent("settings", "Тест с новыми настройками запущен.");
    }
  }

  recordTrade(ts = Date.now()) {
    const stamp = Number(ts);
    if (!Number.isFinite(stamp) || stamp <= 0) return;
    this.tradeTimestamps.push(stamp);
    if (this.tradeTimestamps.length > 500) this.tradeTimestamps = this.tradeTimestamps.slice(-500);
  }

  _estimateEtaSec() {
    if (this.tradeTimestamps.length < 3) return null;
    const deltas = [];
    for (let i = 1; i < this.tradeTimestamps.length; i++) {
      const d = (this.tradeTimestamps[i] - this.tradeTimestamps[i - 1]) / 1000;
      if (Number.isFinite(d) && d > 0) deltas.push(d);
    }
    if (deltas.length < 2) return null;
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }

  logEta() {
    this.lastEtaSec = this._estimateEtaSec();
    this._pushLog(`Оценка до следующей сделки: ${formatSec(this.lastEtaSec)}`);
  }

  shouldExploitBestPreset({ minTrades = 30, minSegments = 6 } = {}) {
    return this.totalTrades >= minTrades && this.totalSegments >= minSegments && !!this.bestPresetName;
  }

  updateOnSegment(preset, segmentDeltaSummary, segment) {
    const name = preset?.name || "preset";
    const current = this.perPreset.get(name) || { trades: 0, wins: 0, losses: 0, netPnlUSDT: 0, segments: 0 };
    current.trades += Number(segmentDeltaSummary?.trades || 0);
    current.wins += Number(segmentDeltaSummary?.wins || 0);
    current.losses += Number(segmentDeltaSummary?.losses || 0);
    current.netPnlUSDT += Number(segmentDeltaSummary?.netPnlUSDT || 0);
    current.segments += 1;
    this.perPreset.set(name, current);

    this.totalTrades += Number(segmentDeltaSummary?.trades || 0);
    this.totalSegments += 1;

    this._pushLog(`Сегмент ${segment}: preset=${name} netPnL=${Number(segmentDeltaSummary?.netPnlUSDT || 0).toFixed(2)} trades=${Number(segmentDeltaSummary?.trades || 0)}`);

    if (this.totalTrades < 5) {
      this.statusText = "нужно тестировать текущие настройки";
      this.logEta();
      return { recommendation: null, proposedPatch: null, bestPresetName: this.bestPresetName };
    }

    const best = [...this.perPreset.entries()].sort((a, b) => b[1].netPnlUSDT - a[1].netPnlUSDT)[0];
    if (best) {
      this.bestPresetName = best[0];
      this.statusText = `лучший пресет сейчас: ${best[0]}`;
      this._pushLog(`Лучший пресет по netPnL: ${best[0]} (${best[1].netPnlUSDT.toFixed(2)} USDT)`);
    }

    this.logEta();
    const { recommendation, proposedPatch } = this._buildRecommendation(name, preset, segmentDeltaSummary);
    if (recommendation) this._pushLog(recommendation);

    return { recommendation, proposedPatch, bestPresetName: this.bestPresetName };
  }

  _buildRecommendation(name, preset, segmentDeltaSummary) {
    const trades = Number(segmentDeltaSummary?.trades || 0);
    const wins = Number(segmentDeltaSummary?.wins || 0);
    const net = Number(segmentDeltaSummary?.netPnlUSDT || 0);
    if (trades < 10) {
      return {
        recommendation: `Рекомендация для preset=${name}: данных мало, продолжаем наблюдение без изменений.`,
        proposedPatch: null,
      };
    }

    const winRate = trades > 0 ? wins / trades : 0;
    const changes = {};

    if (net < 0 || winRate < 0.45) {
      changes.minCorr = Number((Math.max(0.05, Number(preset?.minCorr || 0.2) + 0.02)).toFixed(2));
      changes.impulseZ = Number((Math.max(0.6, Number(preset?.impulseZ || 2) + 0.1)).toFixed(2));
      if (net < 0) {
        changes.cooldownBars = Math.max(0, Math.round(Number(preset?.cooldownBars || 10) + 2));
      }
    } else if (winRate > 0.62 && net > 0) {
      changes.tpSigma = Number((Math.min(4, Number(preset?.tpSigma || 1.3) + 0.1)).toFixed(2));
      changes.cooldownBars = Math.max(0, Math.round(Number(preset?.cooldownBars || 10) - 1));
    }

    if (!Object.keys(changes).length) {
      return {
        recommendation: `Рекомендация для preset=${name}: оставить параметры без изменений и накопить больше статистики.`,
        proposedPatch: null,
      };
    }

    const patch = { presetName: name, changes };
    return {
      recommendation: `Рекомендация для preset=${name}: подкрутить ${Object.keys(changes).join(", ")} и проверить на новом отрезке. Учитывай, что вход теперь с подтверждением фолловера и edge-gate по издержкам.`,
      proposedPatch: patch,
    };
  }

  canAutoTune({ presetName, currentSegment, minSegmentGap = 3 } = {}) {
    const last = Number(this.lastTuneSegmentByPreset.get(presetName) || 0);
    return (Number(currentSegment) - last) >= minSegmentGap;
  }

  markAutoTuneApplied({ presetName, segment }) {
    this.lastTuneSegmentByPreset.set(presetName, Number(segment) || 0);
  }

  reset() {
    this.statusText = "нужно тестировать текущие настройки";
    this.totalTrades = 0;
    this.totalSegments = 0;
    this.perPreset.clear();
    this.log = [];
    this.bestPresetName = null;
    this.tradeTimestamps = [];
    this.currentState = "STOPPED";
    this.lastEtaSec = null;
    this.lastTuneSegmentByPreset.clear();
    this.lastPresetsHash = null;
    this.lastSettingsHash = null;
    this.runningSettingsHash = null;
    this.logEvent("reset", "История обучения очищена.");
  }

  getLearningPayload() {
    return {
      statusText: this.statusText,
      bestPresetName: this.bestPresetName,
      log: this.log,
      state: this.currentState,
      etaSec: this.lastEtaSec,
      lastSettingsHash: this.lastSettingsHash,
      runningSettingsHash: this.runningSettingsHash,
    };
  }
}
