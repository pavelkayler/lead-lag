import crypto from "crypto";

/**
 * Bybit V5 REST client.
 *
 * - Private endpoints: signed HMAC SHA256 (signType=2).
 * - Public endpoints: no auth headers.
 *
 * This client is used for BOTH:
 *   - trade/account REST (private)
 *   - market endpoints (public) used by SymbolUniverse
 */

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function stableStringify(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    const v = value[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
  }
  return `{${parts.join(",")}}`;
}

function buildQueryString(query) {
  if (!query || typeof query !== "object") return "";
  const keys = Object.keys(query)
    .filter((k) => query[k] !== undefined && query[k] !== null)
    .sort();
  const usp = new URLSearchParams();
  for (const k of keys) usp.append(k, String(query[k]));
  return usp.toString();
}

export class BybitRestClient {
  constructor({ baseUrl, apiKey, apiSecret, recvWindowMs = 5000, logger = null } = {}) {
    this.baseUrl = String(baseUrl || process.env.BYBIT_HTTP_URL || "https://api-demo.bybit.com").replace(/\/+$/, "");
    this.apiKey = apiKey || process.env.BYBIT_API_KEY || "";
    this.apiSecret = apiSecret || process.env.BYBIT_API_SECRET || "";
    this.recvWindowMs = Number(process.env.BYBIT_RECV_WINDOW || recvWindowMs);
    this.logger = logger;
  }

  _authHeaders(method, queryString, bodyString) {
    const ts = Date.now().toString();
    const recv = this.recvWindowMs.toString();

    const prehash =
      method === "GET"
        ? `${ts}${this.apiKey}${recv}${queryString || ""}`
        : `${ts}${this.apiKey}${recv}${bodyString || ""}`;
    const sign = hmacHex(this.apiSecret, prehash);

    return {
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-SIGN": sign,
      "X-BAPI-API-KEY": this.apiKey,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv,
    };
  }

  async request(method, path, { query = null, body = null, auth = true } = {}) {
    const qs = buildQueryString(query);
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const bodyString = body ? stableStringify(body) : "";

    const headers = {
      "content-type": "application/json",
    };

    const needAuth = auth && !!this.apiKey && !!this.apiSecret;
    if (needAuth) {
      Object.assign(headers, this._authHeaders(method, qs, bodyString));
    } else if (auth) {
      // auth requested but missing keys
      throw new Error("REST: Set BYBIT_API_KEY and BYBIT_API_SECRET");
    }

    const init = { method, headers };
    if (method !== "GET" && body) init.body = bodyString;

    const t0 = Date.now();
    const res = await fetch(url, init);
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    this.logger?.log("bybit_rest", {
      method,
      path,
      status: res.status,
      ms: Date.now() - t0,
      retCode: json?.retCode,
      retMsg: json?.retMsg,
      auth: needAuth,
    });

    if (!res.ok) throw new Error(`REST HTTP ${res.status}: ${text.slice(0, 240)}`);
    if (json?.retCode != null && json.retCode !== 0) {
      throw new Error(`REST retCode=${json.retCode}: ${json.retMsg || "error"}`);
    }
    return json;
  }

  // Private helpers
  async get(path, query) {
    return this.request("GET", path, { query, auth: true });
  }
  async post(path, body) {
    return this.request("POST", path, { body, auth: true });
  }

  // Public helpers
  async publicGet(path, query) {
    return this.request("GET", path, { query, auth: false });
  }

  // ---- Public Market Endpoints (used by SymbolUniverse) ----

  async marketInstrumentsInfo({ category, limit = 1000, cursor = null } = {}) {
    return this.publicGet("/v5/market/instruments-info", {
      category,
      limit,
      cursor: cursor || undefined,
    });
  }

  async marketTickers({ category } = {}) {
    return this.publicGet("/v5/market/tickers", { category });
  }
}
