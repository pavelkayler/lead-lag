export function evaluateCandidate(symbol, features, config) {
  const longSetup = features.nearSupport && features.liqLong15m >= config.liqThreshUSDT && features.volZ >= config.volZThresh && features.cvdSlope >= 0;
  const shortSetup = features.nearResistance && features.liqShort15m >= config.liqThreshUSDT && features.volZ >= config.volZThresh && features.cvdSlope <= 0;
  if (longSetup) return { symbol, side: 'Buy', reason: 'LONG_SETUP', features };
  if (shortSetup) return { symbol, side: 'Sell', reason: 'SHORT_SETUP', features };
  return null;
}
