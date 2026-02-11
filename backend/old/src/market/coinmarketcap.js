import { httpFetch } from "../utils/httpFetch.js";

const CMC_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CoinMarketCapClient {
  constructor({ logger = null, timeoutMs = 9_000, retries = 2, bybitRest = null } = {}) {
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.bybitRest = bybitRest;
  }

  _getApiKey() {
    return process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || "";
  }

  async _fetchListings({ limit = 200 } = {}) {
    const apiKey = this._getApiKey();
    if (!apiKey) throw new Error("CMC API key is not configured");

    const params = new URLSearchParams({
      start: "1",
      limit: String(Math.max(1, Math.min(5000, Number(limit) || 200))),
      convert: "USD",
      sort: "market_cap",
      sort_dir: "desc",
    });

    let lastErr = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await httpFetch(`${CMC_URL}?${params.toString()}`, {
          headers: {
            Accept: "application/json",
            "X-CMC_PRO_API_KEY": apiKey,
          },
          timeoutMs: this.timeoutMs,
        });

        if (res.status !== 200) {
          throw new Error(`CMC status=${res.status} body=${String(res.text || "").slice(0, 200)}`);
        }

        const json = JSON.parse(res.text || "{}");
        const data = Array.isArray(json?.data) ? json.data : [];
        return data;
      } catch (err) {
        lastErr = err;
        this.logger?.log("cmc_listings_error", { attempt: attempt + 1, error: String(err?.message || err) });
        if (attempt < this.retries) await sleep(400 * (attempt + 1));
      }
    }

    throw lastErr || new Error("Failed to fetch CMC listings");
  }

  async getMarketCapsMap({ limit = 200 } = {}) {
    const data = await this._fetchListings({ limit });
    const out = new Map();
    for (const item of data) {
      const symbol = String(item?.symbol || "").toUpperCase();
      const cap = Number(item?.quote?.USD?.market_cap);
      if (!symbol || !Number.isFinite(cap)) continue;
      out.set(symbol, cap);
    }
    return out;
  }

  async getUniverseFromRating({ limit = 100, minMarketCapUsd = 10_000_000, listingsLimit = 500 } = {}) {
    const requested = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = await this._fetchListings({ limit: Math.max(requested * 3, Number(listingsLimit) || 500) });

    let bybitSet = null;
    if (this.bybitRest) {
      bybitSet = new Set();
      const r = await this.bybitRest.marketInstrumentsInfo({ category: "linear", limit: 1000 });
      const list = r?.result?.list || [];
      for (const it of list) {
        const sym = String(it?.symbol || "").toUpperCase();
        const quote = String(it?.quoteCoin || "").toUpperCase();
        const status = String(it?.status || "").toLowerCase();
        if (!sym || quote !== "USDT") continue;
        if (status && status !== "trading") continue;
        bybitSet.add(sym);
      }
    }

    const out = [];
    for (const item of rows) {
      const ticker = String(item?.symbol || "").toUpperCase();
      const cap = Number(item?.quote?.USD?.market_cap);
      if (!ticker || !Number.isFinite(cap) || cap < Number(minMarketCapUsd || 0)) continue;
      const symbol = `${ticker}USDT`;
      if (bybitSet && !bybitSet.has(symbol)) continue;
      out.push(symbol);
      if (out.length >= requested) break;
    }

    return out;
  }
}
