const cache = new Map<string, { expires: number; value: any }>();
export async function getInstrument(symbol: string, ttlMs = 10 * 60_000) {
  const now = Date.now();
  const hit = cache.get(symbol);
  if (hit && hit.expires > now) return hit.value;
  const value = await fetch(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`).then(r => r.json());
  cache.set(symbol, { value, expires: now + ttlMs });
  return value;
}
