export async function selectUniverse(restClient, config) {
  const tickers = await restClient.getTickers();
  return tickers
    .filter((t) => Number(t.turnover24h || 0) >= config.minTurnover24hUSDT)
    .sort((a, b) => Number(b.turnover24h || 0) - Number(a.turnover24h || 0))
    .slice(0, config.maxSymbols)
    .map((t) => t.symbol);
}
