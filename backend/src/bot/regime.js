export function detectRegime(btcKlines = []) {
  if (btcKlines.length < 4) return { regime: 'CRAB', trendStrength: 0 };
  const first = Number(btcKlines[0].close);
  const last = Number(btcKlines[btcKlines.length - 1].close);
  const movePct = Math.abs(((last - first) / first) * 100);
  return {
    regime: movePct > 3 ? 'TREND' : 'CRAB',
    trendStrength: movePct
  };
}
