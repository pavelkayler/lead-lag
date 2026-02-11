export const configSchema = {
  groups: [
    {
      id: 'universe',
      title: 'Universe',
      fields: [
        { key: 'minTurnover24hUSDT', type: 'number', unit: 'USDT', default: 50000000, min: 1000000, max: 1000000000, step: 1000000, advanced: false, description: 'Minimum 24h turnover for symbol inclusion.' },
        { key: 'minATRPct15m', type: 'number', unit: '%', default: 5, min: 0.5, max: 30, step: 0.1, advanced: false, description: 'Minimum ATR percent on 15m timeframe.' },
        { key: 'maxSymbols', type: 'number', unit: 'count', default: 30, min: 1, max: 100, step: 1, advanced: false, description: 'Maximum symbols in active universe.' },
        { key: 'tradeOnlyCrab', type: 'boolean', default: true, advanced: false, description: 'Allow entries only when BTC regime is crab.' }
      ]
    },
    {
      id: 'signals',
      title: 'Signal Filters',
      fields: [
        { key: 'liqThreshUSDT', type: 'number', unit: 'USDT', default: 250000, min: 10000, max: 10000000, step: 10000, advanced: false, description: 'Minimum liquidation spike size in 15m.' },
        { key: 'volZThresh', type: 'number', unit: 'z', default: 2, min: 0.5, max: 10, step: 0.1, advanced: false, description: 'Volume z-score threshold.' },
        { key: 'cvdLookbackBars', type: 'number', unit: 'bars', default: 3, min: 1, max: 20, step: 1, advanced: true, description: 'Bars for CVD slope confirmation.' }
      ]
    },
    {
      id: 'execution',
      title: 'Execution & Risk',
      fields: [
        { key: 'entrySplitPct', type: 'number', unit: '%', default: 50, min: 10, max: 90, step: 5, advanced: false, description: 'Percent for first entry split.' },
        { key: 'addMovePct', type: 'number', unit: '%', default: 2.5, min: 0.2, max: 10, step: 0.1, advanced: false, description: 'Adverse move percent before second entry.' },
        { key: 'slPctDefault', type: 'number', unit: '%', default: 4, min: 0.5, max: 15, step: 0.1, advanced: false, description: 'Default stop-loss percent.' },
        { key: 'tp1Pct', type: 'number', unit: '%', default: 3, min: 1, max: 20, step: 0.1, advanced: false, description: 'Take-profit level 1 percent.' },
        { key: 'tp2Pct', type: 'number', unit: '%', default: 7, min: 1, max: 40, step: 0.1, advanced: false, description: 'Take-profit level 2 percent.' },
        { key: 'tp1ClosePct', type: 'number', unit: '%', default: 40, min: 5, max: 95, step: 5, advanced: false, description: 'Percent of position to close at TP1.' },
        { key: 'beBufferBps', type: 'number', unit: 'bps', default: 5, min: 0, max: 200, step: 1, advanced: true, description: 'Break-even stop buffer in basis points after TP1.' },
        { key: 'maxHoldHoursAlt', type: 'number', unit: 'hours', default: 6, min: 1, max: 24, step: 1, advanced: false, description: 'Maximum hold duration for altcoins.' },
        { key: 'maxHoldHoursBtc', type: 'number', unit: 'hours', default: 12, min: 1, max: 24, step: 1, advanced: false, description: 'Maximum hold duration for BTC.' },
        { key: 'paperSlippageBps', type: 'number', unit: 'bps', default: 2, min: 0, max: 100, step: 1, advanced: true, description: 'Paper trading slippage.' }
      ]
    }
  ]
};

export function schemaDefaults() {
  const out = {};
  for (const group of configSchema.groups) {
    for (const field of group.fields) out[field.key] = field.default;
  }
  return out;
}

export function validateConfig(input) {
  const defaults = schemaDefaults();
  const merged = { ...defaults, ...input };
  for (const group of configSchema.groups) {
    for (const field of group.fields) {
      const value = merged[field.key];
      if (field.type === 'number') {
        if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`${field.key} must be number`);
        if (value < field.min || value > field.max) throw new Error(`${field.key} out of range`);
      }
      if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${field.key} must be boolean`);
    }
  }
  return merged;
}
