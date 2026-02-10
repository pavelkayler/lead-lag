import { blocker } from "./intents.js";

export function selectUniverse(symbols, featuresMap, rangesMap, cfg) {
  const rows = [];
  for (const symbol of symbols) {
    const f = featuresMap[symbol];
    const r = rangesMap[symbol];
    if (!f || !r) continue;
    const blockers = [];
    blockers.push(blocker("turnover", "Turnover24h >= min", f.turnover24h, cfg.minTurnover24hUSDT, f.turnover24h >= cfg.minTurnover24hUSDT));
    blockers.push(blocker("atr", "ATRpct15m >= min", f.atrPct15m, cfg.minATRPct15m, Number(f.atrPct15m) >= Number(cfg.minATRPct15m)));
    if (cfg.useSpreadFilter) blockers.push(blocker("spread", "Spread <= max", f.spreadBps, cfg.maxSpreadBps, Number(f.spreadBps) <= Number(cfg.maxSpreadBps)));

    const pass = blockers.every((b) => b.pass);
    const activityScore =
      Number(cfg.w1) * Number(f.volZ || 0) +
      Number(cfg.w2) * Math.abs(Number(f.oiDeltaPct15m || 0)) +
      Number(cfg.w3) * Number(f.liqSpike || 0) +
      Number(cfg.w4) * Math.abs(Number(f.cvdSlope || 0));

    let suggestedSide = "none";
    if (r.nearSupport) suggestedSide = "long";
    if (r.nearResistance) suggestedSide = suggestedSide === "long" ? "both" : "short";

    rows.push({
      symbol,
      score: Number.isFinite(activityScore) ? activityScore : 0,
      suggestedSide,
      nearSupport: r.nearSupport,
      nearResistance: r.nearResistance,
      S: r.S,
      R: r.R,
      band: r.band,
      features: {
        volZ: f.volZ, oiDeltaPct15m: f.oiDeltaPct15m, liqSpikeLong: f.liqLong15m, liqSpikeShort: f.liqShort15m,
        fundingScore: f.fundingScore, cvdSlope: f.cvdSlope, atrPct15m: f.atrPct15m, spreadBps: f.spreadBps, turnover24h: f.turnover24h,
      },
      blockers,
      pass,
    });
  }

  return rows
    .sort((a, b) => (b.pass - a.pass) || (b.score - a.score))
    .slice(0, cfg.topN);
}
