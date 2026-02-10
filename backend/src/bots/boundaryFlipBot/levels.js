const TF_TO_BYBIT = { "5m": "5", "15m": "15", "1h": "60" };

export async function loadLevels({ rest, symbol, timeframe = "15m", lookback = 48 }) {
  const interval = TF_TO_BYBIT[timeframe] || "15";
  const resp = await rest.publicGet("/v5/market/kline", { category: "linear", symbol, interval, limit: Math.max(20, lookback) });
  const list = Array.isArray(resp?.result?.list) ? resp.result.list : [];
  const bars = list.map((x) => ({
    ts: Number(x[0]),
    open: Number(x[1]),
    high: Number(x[2]),
    low: Number(x[3]),
    close: Number(x[4]),
  })).filter((b) => Number.isFinite(b.high) && Number.isFinite(b.low));
  if (!bars.length) throw new Error("BoundaryFlip: no OHLCV bars");
  let upper = -Infinity;
  let lower = Infinity;
  for (const b of bars) {
    if (b.high > upper) upper = b.high;
    if (b.low < lower) lower = b.low;
  }
  return { upper, lower, bars };
}

export function getLastClosedBar(levels = {}) {
  const bars = Array.isArray(levels.bars) ? levels.bars : [];
  return bars.length ? bars[0] : null;
}
