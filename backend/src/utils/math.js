export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function roundStep(value, step) {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function normalizeQty(rawQty, instrument) {
  const qty = roundStep(rawQty, instrument.qtyStep || 0.001);
  return Math.max(instrument.minQty || 0.001, Number(qty.toFixed(8)));
}

export function normalizePrice(rawPrice, instrument) {
  const price = roundStep(rawPrice, instrument.tickSize || 0.1);
  return Number(price.toFixed(8));
}

export function zScore(series) {
  if (series.length < 2) return 0;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance = series.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (series.length - 1);
  if (variance === 0) return 0;
  return (series[series.length - 1] - mean) / Math.sqrt(variance);
}
