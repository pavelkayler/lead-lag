export function calcRangeBands(symbol, mdl, cfg) {
  const bars = mdl.getBars(symbol, 320);
  if (bars.length < 40) return { S: null, R: null, band: null, nearSupport: false, nearResistance: false };
  const vals = bars.map((b) => Number(b?.mid || b?.c || 0)).filter((x) => x > 0);
  const look = vals.slice(-cfg.lookbackBars);
  if (!look.length) return { S: null, R: null, band: null, nearSupport: false, nearResistance: false };
  const S = Math.min(...look);
  const R = Math.max(...look);
  const price = vals[vals.length - 1];
  const atrPct = Math.max(0.001, Number(cfg.nearBandATRk || 0.4) / 100);
  const band = atrPct;
  const nearSupport = price <= S * (1 + band);
  const nearResistance = price >= R * (1 - band);
  return { S, R, band, nearSupport, nearResistance };
}
