import { calcATRpctFromBars } from "./featureEngine.js";

function slope(arr) {
  if (arr.length < 3) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = arr.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    num += dx * (arr[i] - yMean);
    den += dx * dx;
  }
  return den > 0 ? num / den : 0;
}

export function detectRegimeBTC(mdl, cfg) {
  const bars1h = mdl.getBars("BTCUSDT", 240);
  if (bars1h.length < 30) return { regime: "UNCLEAR", trendStrength: 0, rangeBoundedness: 0, atrPct: null, impulseCandlesCount: 0 };
  const closes = bars1h.map((b) => Number(b?.mid || b?.c || 0)).filter((x) => x > 0);
  const s = slope(closes.slice(-Math.min(closes.length, 48)));
  const atrPct = calcATRpctFromBars(bars1h, 14) || 0;
  const diffs = closes.slice(1).map((c, i) => Math.abs(c - closes[i]) / closes[i]);
  const impulseCandlesCount = diffs.slice(-24).filter((d) => d > (1.5 * atrPct / 100)).length;
  const lo = Math.min(...closes.slice(-24));
  const hi = Math.max(...closes.slice(-24));
  const inside = closes.slice(-24).filter((c) => c >= lo + 0.2 * (hi - lo) && c <= hi - 0.2 * (hi - lo)).length;
  const rangeBoundedness = inside / 24;
  const trendStrength = Math.abs(s) / Math.max(1e-9, closes[closes.length - 1]);

  let regime = "CRAB";
  if (trendStrength > 0.0025 || impulseCandlesCount >= 4) regime = s >= 0 ? "IMPULSE_UP" : "IMPULSE_DOWN";
  if (rangeBoundedness < 0.35 && regime === "CRAB") regime = "UNCLEAR";
  return { regime, trendStrength, rangeBoundedness, atrPct, impulseCandlesCount };
}
