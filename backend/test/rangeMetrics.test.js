import test from 'node:test';
import assert from 'node:assert/strict';
import { calcATRpctFromBars, calcVolZ, calcCvd, calcLiqSpike } from '../src/rangeMetricsIntraday/featureEngine.js';
import { detectRegimeBTC } from '../src/rangeMetricsIntraday/regimeDetector.js';

test('ATR and VolZ basics', () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ mid: 100 + i * 0.2, r: Math.sin(i / 5) }));
  assert.ok(calcATRpctFromBars(bars, 14) > 0);
  assert.ok(Number.isFinite(calcVolZ(bars, 24)));
});

test('CVD and liquidation spike', () => {
  const trades = [{ side: 'Buy', size: 10 }, { side: 'Sell', size: 5 }];
  assert.equal(calcCvd(trades), 5);
  const liq = [{ size: 1 }, { size: 2 }, { size: 8 }, { size: 10 }];
  assert.ok(calcLiqSpike(liq, 0.75) > 0);
});

test('regime detector returns enum', () => {
  const mdl = { getBars: () => Array.from({ length: 80 }, (_, i) => ({ mid: 100 + (i % 5) })) };
  const out = detectRegimeBTC(mdl, {});
  assert.ok(['CRAB', 'IMPULSE_UP', 'IMPULSE_DOWN', 'UNCLEAR'].includes(out.regime));
});
