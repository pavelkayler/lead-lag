function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function std(a) { const m = mean(a); const v = mean(a.map((x) => (x - m) ** 2)); return Math.sqrt(v); }
function quantile(a, q = 0.5) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))]; }

export function calcATRpctFromBars(bars, len = 14) {
  if (!Array.isArray(bars) || bars.length < len + 2) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const p = Number(bars[i - 1]?.c || bars[i - 1]?.mid || 0);
    const c = Number(bars[i]?.c || bars[i]?.mid || 0);
    if (p > 0 && c > 0) trs.push(Math.abs(c - p) / p);
  }
  const tail = trs.slice(-len);
  return tail.length ? mean(tail) : null;
}

export function calcVolZ(bars, windowBars = 48) {
  const vols = (bars || []).map((b) => Number(b?.v || Math.abs(Number(b?.r || 0)))).filter(Number.isFinite);
  if (vols.length < Math.max(10, windowBars / 2)) return null;
  const tail = vols.slice(-windowBars);
  const m = mean(tail);
  const s = std(tail) || 1;
  return (tail[tail.length - 1] - m) / s;
}

export function calcCvd(trades = []) {
  let cvd = 0;
  for (const t of trades) {
    const s = Number(t?.size || 0);
    if (!Number.isFinite(s)) continue;
    cvd += String(t?.side || "").toLowerCase().includes("buy") ? s : -s;
  }
  return cvd;
}

export function calcLiqSpike(liqs = [], q = 0.9) {
  const sizes = liqs.map((x) => Number(x?.size || 0)).filter((x) => Number.isFinite(x) && x > 0);
  if (!sizes.length) return 0;
  const th = quantile(sizes, q);
  const hit = sizes.filter((s) => s >= th).reduce((a, b) => a + b, 0);
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return hit / total;
}

export function computeFeatures(symbol, mdl, cfg) {
  const bars1m = mdl.getBars(symbol, 120);
  const bars5m = mdl.getBars(symbol, 360);
  const ticker = mdl.getTicker(symbol);
  const trades = mdl.getTrades(symbol, cfg.cvdWindowMin * 60 * 1000);
  const liqs = mdl.getLiquidations(symbol, cfg.liqSpikeWindowMin * 60 * 1000);
  const oiHist = mdl.oiHistory.get(symbol) || [];
  const fundingHist = mdl.fundingHistory.get(symbol) || [];

  const retFrom = (n) => {
    if (bars1m.length < n + 1) return null;
    const a = Number(bars1m[bars1m.length - n - 1]?.mid || 0);
    const b = Number(bars1m[bars1m.length - 1]?.mid || 0);
    return a > 0 && b > 0 ? Math.log(b / a) : null;
  };

  const oiNow = Number(ticker?.openInterest || 0) || (oiHist.length ? oiHist[oiHist.length - 1].oi : null);
  const oiPast = oiHist.length > 3 ? oiHist[Math.max(0, oiHist.length - 4)].oi : null;
  const oiDelta = (Number.isFinite(oiNow) && Number.isFinite(oiPast)) ? (oiNow - oiPast) : null;
  const oiDeltaPct = (Number.isFinite(oiDelta) && Number.isFinite(oiPast) && oiPast > 0) ? (oiDelta / oiPast) * 100 : null;

  const fundingNow = Number(ticker?.fundingRate);
  const fundingVals = fundingHist.map((x) => x.rate).filter(Number.isFinite);
  const fundingScore = cfg.useAbsFundingThreshold
    ? (Math.abs(fundingNow) / Math.max(1e-6, Number(cfg.absFundingThreshold || 0.003)))
    : (fundingVals.length ? fundingVals.filter((x) => x <= fundingNow).length / fundingVals.length : 0);

  const liqLong = liqs.filter((x) => String(x.side).toLowerCase().includes("sell")).reduce((s, x) => s + Number(x.size || 0), 0);
  const liqShort = liqs.filter((x) => String(x.side).toLowerCase().includes("buy")).reduce((s, x) => s + Number(x.size || 0), 0);

  const cvd = calcCvd(trades);
  const prevTrades = mdl.getTrades(symbol, cfg.cvdWindowMin * 2 * 60 * 1000);
  const cvdPrev = calcCvd(prevTrades.slice(0, Math.max(0, prevTrades.length - trades.length)));

  return {
    symbol,
    ret_1m: retFrom(1),
    ret_5m: retFrom(5),
    ret_15m: retFrom(15),
    atrPct15m: calcATRpctFromBars(bars5m, cfg.atrLen),
    volZ: calcVolZ(bars1m, cfg.volZWindowBars),
    oiNow,
    oiDelta15m: oiDelta,
    oiDeltaPct15m: oiDeltaPct,
    fundingNow,
    fundingScore,
    liqLong15m: liqLong,
    liqShort15m: liqShort,
    liqSpike: calcLiqSpike(liqs, cfg.liqSpikeQuantile),
    cvd5m: cvd,
    cvdSlope: cvd - cvdPrev,
    spreadBps: Number(ticker?.spreadBps || 0),
    turnover24h: Number(ticker?.turnover24h || ticker?.volume24h || 0),
  };
}
