import { httpFetch } from "./httpFetch.js";

function nowMs() { return Date.now(); }

export class SymbolUniverse {
  constructor({ bybitRest, logger = null } = {}) {
    this.rest = bybitRest;
    this.logger = logger;

    this.cache = null; // { ts, symbols }
    this.cacheMs = 60 * 60 * 1000;
  }

  async getTopUSDTPerps({ count = 30, minMarketCapUsd = 10_000_000 } = {}) {
    if (this.cache && (nowMs() - this.cache.ts) < this.cacheMs) return this.cache.symbols;

    const cmcKey = process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || "";
    if (!cmcKey) {
      // Fallback: purely Bybit liquidity-based (no CMC)
      const symbols = await this._bybitTopByTurnover({ count });
      this.cache = { ts: nowMs(), symbols };
      return symbols;
    }

    // 1) Pull CMC listings (market_cap_min filter)
    const cmc = await this._cmcSymbols({ apiKey: cmcKey, minMarketCapUsd });
    const cmcTickers = new Set(cmc.map((s) => String(s).toUpperCase()));

    // 2) Pull Bybit linear instruments and tickers, map candidates to Bybit symbols
    const bybitSymbols = await this._bybitLinearSymbolsUSDT();
    const bybitSet = new Set(bybitSymbols);

    const mapped = [];
    for (const t of cmcTickers) {
      const sym = `${t}USDT`;
      if (bybitSet.has(sym)) mapped.push(sym);
    }

    // 3) Rank mapped by turnover24h on Bybit
    const ranked = await this._rankByTurnover(mapped);
    const top = ranked.slice(0, count).map((x) => x.symbol);

    // Fallback if too few matched
    const fill = top.length < count ? await this._bybitTopByTurnover({ count }) : [];
    const out = Array.from(new Set([...top, ...fill])).slice(0, count);

    this.cache = { ts: nowMs(), symbols: out };
    this.logger?.log("universe_top", { count, minMarketCapUsd, symbols: out, source: "cmc+bybit" });
    return out;
  }

  async _cmcSymbols({ apiKey, minMarketCapUsd }) {
    // Use listings/latest; supports market_cap_min.
    // Docs: https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest
    const limit = 5000;
    const url =
      `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest` +
      `?start=1&limit=${limit}&convert=USD&market_cap_min=${encodeURIComponent(minMarketCapUsd)}`;

    const res = await httpFetch(url, { headers: { "X-CMC_PRO_API_KEY": apiKey, "Accept": "application/json" }, timeoutMs: 15000 });
    if (res.status !== 200) throw new Error(`CMC error status=${res.status}: ${res.text.slice(0, 200)}`);

    let j;
    try { j = JSON.parse(res.text); } catch { throw new Error("CMC invalid JSON"); }
    if (!j || !Array.isArray(j.data)) throw new Error("CMC unexpected response");

    return j.data.map((it) => it?.symbol).filter(Boolean);
  }

  async _bybitLinearSymbolsUSDT() {
    // instruments-info is paginated with cursor.
    const out = [];
    let cursor = null;
    for (let i = 0; i < 10; i++) {
      const r = await this.rest.marketInstrumentsInfo({ category: "linear", limit: 1000, cursor });
      const list = r?.result?.list || r?.result?.items || [];
      for (const it of list) {
        const sym = it?.symbol;
        const status = String(it?.status || "").toLowerCase();
        const quote = String(it?.quoteCoin || it?.quote_currency || "").toUpperCase();
        if (!sym) continue;
        if (quote !== "USDT") continue;
        if (status && status !== "trading") continue;
        out.push(sym);
      }
      cursor = r?.result?.nextPageCursor || r?.result?.cursor || null;
      if (!cursor) break;
    }
    return out;
  }

  async _rankByTurnover(symbols) {
    if (!symbols.length) return [];
    // pull all tickers once, build map
    const r = await this.rest.marketTickers({ category: "linear" });
    const list = r?.result?.list || [];
    const mp = new Map();
    for (const it of list) {
      const sym = it?.symbol;
      if (!sym) continue;
      const t = Number(it?.turnover24h || it?.turnover_24h || it?.volume24h || it?.volume_24h);
      if (Number.isFinite(t)) mp.set(sym, t);
    }
    const ranked = symbols
      .map((s) => ({ symbol: s, turnover24h: mp.get(s) || 0 }))
      .sort((a, b) => b.turnover24h - a.turnover24h);
    return ranked;
  }

  async _bybitTopByTurnover({ count }) {
    const r = await this.rest.marketTickers({ category: "linear" });
    const list = r?.result?.list || [];
    const filtered = list
      .filter((it) => String(it?.symbol || "").endsWith("USDT"))
      .map((it) => ({ symbol: it.symbol, turnover24h: Number(it.turnover24h || 0) }))
      .filter((x) => x.symbol && Number.isFinite(x.turnover24h))
      .sort((a, b) => b.turnover24h - a.turnover24h)
      .slice(0, count)
      .map((x) => x.symbol);
    this.logger?.log("universe_top_fallback", { count, symbols: filtered, source: "bybit-only" });
    return filtered;
  }
}
