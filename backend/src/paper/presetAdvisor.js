function stableStringify(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export class PresetAdvisor {
  constructor({ maxLog = 200 } = {}) {
    this.maxLog = maxLog;
    this.lastPresetsHash = null;
    this.statusText = "нужно тестировать текущие настройки";
    this.totalTrades = 0;
    this.perPreset = new Map();
    this.log = [];
    this.bestPresetName = null;
  }

  _pushLog(line) {
    this.log.push(`${new Date().toLocaleTimeString("ru-RU")}: ${line}`);
    if (this.log.length > this.maxLog) this.log = this.log.slice(-this.maxLog);
  }

  updateOnStart(presets = []) {
    const hash = stableStringify(presets);
    if (this.lastPresetsHash && hash !== this.lastPresetsHash) {
      this.statusText = "выставлены новые настройки, нужны тесты";
      this._pushLog("Обнаружены новые настройки пресетов, требуется повторное тестирование.");
    } else if (!this.lastPresetsHash) {
      this.statusText = "нужно тестировать текущие настройки";
      this._pushLog("Первичный запуск тестирования пресетов.");
    }
    this.lastPresetsHash = hash;
  }

  updateOnSegment(preset, segmentDeltaSummary, segment) {
    const name = preset?.name || "preset";
    const current = this.perPreset.get(name) || { trades: 0, wins: 0, losses: 0, netPnlUSDT: 0 };
    current.trades += Number(segmentDeltaSummary?.trades || 0);
    current.wins += Number(segmentDeltaSummary?.wins || 0);
    current.losses += Number(segmentDeltaSummary?.losses || 0);
    current.netPnlUSDT += Number(segmentDeltaSummary?.netPnlUSDT || 0);
    this.perPreset.set(name, current);
    this.totalTrades += Number(segmentDeltaSummary?.trades || 0);

    this._pushLog(`Сегмент ${segment}: preset=${name} netPnL=${Number(segmentDeltaSummary?.netPnlUSDT || 0).toFixed(2)} trades=${Number(segmentDeltaSummary?.trades || 0)}`);

    if (this.totalTrades < 5) {
      this.statusText = "нужно тестировать текущие настройки";
      return;
    }

    const best = [...this.perPreset.entries()].sort((a, b) => b[1].netPnlUSDT - a[1].netPnlUSDT)[0];
    if (best) {
      this.bestPresetName = best[0];
      this.statusText = `лучший пресет сейчас: ${best[0]}`;
      this._pushLog(`Лучший пресет по netPnL: ${best[0]} (${best[1].netPnlUSDT.toFixed(2)} USDT)`);
      this._pushLog("Рекомендация: повышать minCorr постепенно и проверять impulseZ на новом тесте.");
    }
  }

  getLearningPayload() {
    return {
      statusText: this.statusText,
      bestPresetName: this.bestPresetName,
      log: this.log,
    };
  }
}
