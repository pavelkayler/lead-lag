export type Regime = 'CRAB' | 'IMPULSE';
export function detectRegime(returns: number[], threshold = 0.008): Regime {
  const avgAbs = returns.reduce((a, b) => a + Math.abs(b), 0) / Math.max(returns.length, 1);
  return avgAbs > threshold ? 'IMPULSE' : 'CRAB';
}
