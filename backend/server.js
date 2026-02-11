import fs from "fs";
import path from "path";

// Minimal .env loader (no deps). Reads ./\.env if present.
function loadDotEnv(cwd = process.cwd()) {
  const p = path.join(cwd, ".env");
  if (!fs.existsSync(p)) return;
  try {
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq <= 0) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch { /* ignore */ }
}
loadDotEnv();


// Public instrument rules cache (best-effort) for qty/price filters.
// Uses mainnet public REST (instrument params are the same for demo trading).
const _instrumentCache = new Map(); // symbol -> { ts, minQty, qtyStep, tickSize }
async function getInstrumentRules(symbol, { ttlMs = 10 * 60 * 1000 } = {}) {
  const sym = String(symbol || "").trim();
  if (!sym) return null;

  const now = Date.now();
  const cached = _instrumentCache.get(sym);
  if (cached && (now - cached.ts) < ttlMs) return cached;

  const url = `https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(sym)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  const item = json?.result?.list?.[0];
  const lot = item?.lotSizeFilter || {};
  const price = item?.priceFilter || {};
  const rules = {
    ts: now,
    minQty: Number(lot.minOrderQty),
    qtyStep: Number(lot.qtyStep),
    tickSize: Number(price.tickSize),
  };
  _instrumentCache.set(sym, rules);
  return rules;
}

function roundToStep(value, step, mode = "nearest") {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return v;
  const n = v / s;
  let k = n;
  if (mode === "floor") k = Math.floor(n);
  else if (mode === "ceil") k = Math.ceil(n);
  else k = Math.round(n);
  const out = k * s;
  // avoid floating residue
  return Number(out.toFixed(12));
}


function stepDecimals(step) {
  const s = String(step ?? "");
  const i = s.indexOf(".");
  return i >= 0 ? (s.length - i - 1) : 0;
}

function fmtStep(value, step, mode = "floor") {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v)) return String(value);
  if (!Number.isFinite(s) || s <= 0) return String(v);
  const out = roundToStep(v, s, mode);
  const d = stepDecimals(step);
  return d > 0 ? out.toFixed(d) : String(Math.trunc(out));
}

async function normalizeQty(symbol, rawQty) {
  const raw = Number(rawQty);
  if (!Number.isFinite(raw) || raw <= 0) return rawQty;
  try {
    const rules = await getInstrumentRules(symbol);
    const minQty = Number(rules?.minQty);
    const qtyStep = Number(rules?.qtyStep);
    let qty = raw;
    if (Number.isFinite(minQty) && minQty > 0) qty = Math.max(qty, minQty);
    if (Number.isFinite(qtyStep) && qtyStep > 0) {
      qty = roundToStep(qty, qtyStep, "floor");
      if (Number.isFinite(minQty) && minQty > 0 && qty < minQty) qty = minQty;
      return fmtStep(qty, qtyStep, "floor");
    }
    return String(qty);
  } catch {
    return String(raw);
  }
}

/**
 * server.js (Step 9)
 * ------------------
 * Adds paper-trading strategy loop (no live trading):
 * - PaperBroker: single-position ledger
 * - LeadLagPaperStrategy: uses lead-lag top pair + leader impulses to trade follower in paper
 * - Streams event:paper
 *
 * Private/Trade WS skeleton remains from Step 8.
 */

import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";

import { JsonlLogger } from "./src/utils/logger.js";
import { WsHub } from "./src/utils/wsHub.js";
import { FeedManager } from "./src/feed/feedManager.js";
import { LeadLagService } from "./src/leadlag/leadLagService.js";
import { resolveBybitConfig } from "./src/exchange/bybitEnv.js";
import { BybitRestClient } from "./src/exchange/bybitRest.js";
import { TradeState } from "./src/trading/tradeState.js";

import { PrivateWsClient } from "./src/exchange/privateWsClient.js";
import { TradeTransport } from "./src/exchange/tradeTransport.js";
import { RiskManager } from "./src/trading/riskManager.js";

import { PaperBroker } from "./src/paper/paperBroker.js";
import { LeadLagPaperStrategy } from "./src/paper/paperStrategy.js";
import { SymbolUniverse } from "./src/utils/symbolUniverse.js";
import { PaperTestRunner } from "./src/paper/paperTestRunner.js";
import { LeadLagLiveTrader } from "./src/trading/leadLagLiveTrader.js";
import { RangeMetricsRunner } from "./src/rangeMetricsIntraday/rangeRunner.js";
import { BoundaryFlipBotRunner } from "./src/bots/boundaryFlipBot/runner.js";
import { BoundaryExecutorAdapter } from "./src/bots/boundaryFlipBot/executorAdapter.js";
import { CycleTracker } from "./src/bots/boundaryFlipBot/cycleTracker.js";

const PORT = process.env.PORT || 8080;
const BYBIT_CFG = resolveBybitConfig();
console.log("[bybit] env:", BYBIT_CFG.env, "| transport:", BYBIT_CFG.tradeTransport);
console.log("[bybit] http:", BYBIT_CFG.httpBaseUrl);
console.log("[bybit] ws public:", BYBIT_CFG.wsPublicUrl);
console.log("[bybit] ws private:", BYBIT_CFG.wsPrivateUrl);
console.log("[bybit] ws trade:", BYBIT_CFG.wsTradeUrl);
console.log("[bybit] hasKey:", !!process.env.BYBIT_API_KEY, "| hasSecret:", !!process.env.BYBIT_API_SECRET);
function sideToHedgeIdx(side) {
  const s = String(side || "").toLowerCase();
  // Hedge mode: 1=Buy/Long, 2=Sell/Short
  return (s === "buy") ? 1 : 2;
}

async function orderCreateWithPositionIdxFallback(rest, params, logger) {
  const p = { ...params };
  const mode = String(process.env.BYBIT_POSITION_MODE || "auto").toLowerCase();

  const idxHedge = sideToHedgeIdx(p.side);

  // First attempt depends on desired mode:
  // - hedge: 1/2
  // - oneway: 0
  // - auto: default 0 (will fallback if mismatch)
  if (mode === "hedge") p.positionIdx = idxHedge;
  else if (mode === "oneway") p.positionIdx = 0;
  else if (p.positionIdx === undefined || p.positionIdx === null) p.positionIdx = 0;

  try {
    return await rest.post("/v5/order/create", p);
  } catch (e) {
    const msg = String(e?.message || "");
    if (!msg.includes("position idx not match position mode")) throw e;

    // Retry with opposite mode idx
    const retryIdx = (Number(p.positionIdx) === 0) ? idxHedge : 0;

    logger?.log("order_create_posidx_retry", {
      symbol: p.symbol,
      side: p.side,
      firstIdx: p.positionIdx,
      retryIdx,
      mode,
    });

    return await rest.post("/v5/order/create", { ...p, positionIdx: retryIdx });
  }
}



const MAX_BUFFERED_BYTES = 256 * 1024;

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
const MAX_BARS_SNAPSHOT = 480;
let HTTP_CTX = { feed: null };

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

async function waitForAuthed(priv, { timeoutMs = 3000, pollMs = 50 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = priv.getStats();
    if (st?.authed) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}


function sendJson(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function sendEvent(ws, topic, payload) {
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
  sendJson(ws, { type: "event", topic, payload });
  return true;
}

function makeOk(id, payload) { return { type: "response", id, ok: true, payload }; }
function makeErr(id, error) { return { type: "response", id, ok: false, error: String(error) }; }

function toHtmlTable(title, rows) {
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (!rows?.length) return `<h3>${esc(title)}</h3><p>Нет данных</p>`;
  const cols = Object.keys(rows[0]);
  const thead = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const tbody = rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("\n");
  return `<h3>${esc(title)}</h3><table border="1" cellspacing="0" cellpadding="6"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function createHttpServer() {
  return http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const u = new URL(req.url || "/", `http://${req.headers.host || 'localhost'}`);
    if (u.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (u.pathname === "/bars") {
      const symbol = (u.searchParams.get("symbol") || "").toUpperCase();
      const n = Math.max(1, Math.min(MAX_BARS_SNAPSHOT, Number(u.searchParams.get("n") || 240)));
      if (!symbol) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "symbol is required" })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ symbol, bars: HTTP_CTX.feed?.getBars(symbol, n) || [] }));
      return;
    }
    if (u.pathname === "/results/latest") {
      const f = path.join(process.cwd(), "results", "latest.json");
      if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fs.readFileSync(f, "utf8"));
      return;
    }
    if (u.pathname === "/results/latest/table") {
      const f = path.join(process.cwd(), "results", "latest.json");
      if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return; }
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      const summaryRows = Object.entries(data.summary || {}).filter(([,v]) => typeof v !== 'object').map(([metric,value]) => ({ metric, value }));
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lead-Lag results</title></head><body>${toHtmlTable("Summary", summaryRows)}${toHtmlTable("PresetsByHour", data.presetsByHour || [])}${toHtmlTable("TopPairs", data.topPairs || [])}</body></html>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
}


function startMetricsTicker(ctx, feed, hub, leadLag, priv, trade, risk, paper, strat, tradeState, paperTest, logger) {
  const toAgeStr = (ms) => (ms != null && Number.isFinite(ms)) ? `${(ms / 1000).toFixed(2)}s` : "-";
  return setInterval(() => {
    if (!ctx.subscriptions.has("metrics")) return;
    if (ctx.ws.readyState !== 1) return;

    const fs = feed.getStats();
    const hs = hub.getStats();
    const ps = priv.getStats();
    const ts = trade.getStats();

    const top = (leadLag.latest?.pairs || []).slice(0, 10).map((p) => ({
      leader: p.leader,
      follower: p.follower,
      corr: p.corr,
      lagMs: p.bestLagMs,
      impulses: p.impulses,
      followerMeanAfterImpulse: p.followerMeanAfterImpulse,
      samples: p.samples,
    }));

    const payload = {
      serverTs: Date.now(),
      env: {
        name: BYBIT_CFG.env,
        tradeTransport: BYBIT_CFG.tradeTransport,
        httpBaseUrl: BYBIT_CFG.httpBaseUrl,
        wsPublicUrl: BYBIT_CFG.wsPublicUrl,
        wsPrivateUrl: BYBIT_CFG.wsPrivateUrl,
        wsTradeUrl: BYBIT_CFG.wsTradeUrl,
        safety: BYBIT_CFG.safety,
      },
      uptimeSec: Math.floor(process.uptime()),
      bufferedBytes: ctx.ws.bufferedAmount,
      subs: Array.from(ctx.subscriptions),
      feedRunning: !!feed.running,
      symbols: Array.isArray(feed.symbols) ? feed.symbols : [],

      // UI-friendly (expected by current frontend bundle)
      feed: {
        wsUp: !!fs.wsUp,
        wsUrl: fs.wsUrl,
        reconnects: fs.reconnects ?? 0,
        lastWsMsgAgeMs: fs.lastWsMsgAgeMs ?? null,
        binance: fs.binance || null,
        bybit: { wsUp: !!fs.wsUp, lastMsgAgeMs: fs.lastWsMsgAgeMs ?? null, reconnects: fs.reconnects ?? 0 },
        barLatencyP50: fs.barLatency?.p50 ?? null,
        barLatencyP90: fs.barLatency?.p90 ?? null,
        barLatencyP99: fs.barLatency?.p99 ?? null,
        wsDelayP50: fs.wsDelay?.p50 ?? null,
        wsDelayP90: fs.wsDelay?.p90 ?? null,
        wsDelayP99: fs.wsDelay?.p99 ?? null,
      },
      hub: {
        clients: hs.clients ?? null,
        sent: hs.sent ?? null,
        dropped: hs.dropped_backpressure ?? null,
      },
      leadLagTop: top,
      private: {
        connected: !!ps.connected,
        authed: !!ps.authed,
        lastMsgAge: toAgeStr(ps.lastMsgAgeMs),
        reconnects: ps.reconnects ?? 0,
      },
      trade: {
        connected: !!ts.connected,
        authed: !!ts.authed,
        lastMsgAge: toAgeStr(ts.lastMsgAgeMs),
        reconnects: ts.reconnects ?? 0,
        note: ts.note || null,
      },

      risk: { enableTrading: risk.enableTrading, maxNotionalUSDT: risk.maxNotionalUSDT, haltTrading: risk.haltTrading, haltReason: risk.haltReason },
      tradeState: tradeState ? tradeState.summary() : null,
      paper: {
        enabled: strat.enabled,
        cashUSDT: paper.cashUSDT,
        equityUSDT: paper.equityUSDT,
        open: !!paper.position,
        stats: paper.stats,
        params: strat.getParams(),
      },
      paperTest: paperTest ? paperTest.getStatus() : null,

      // Backward-compat aliases (older UI)
      feedStats: fs,
      hubStats: hs,
      privateWs: ps,
      tradeWs: ts,
    };

    sendEvent(ctx.ws, "metrics", payload);
    logger?.log("metrics", payload);
  }, 1000);
}


function makeHandlers({ hub, feed, leadLag, priv, trade, risk, paper, strat, tradeState, paperTest, logger, rest, liveTrader, rangeRunner, boundaryFlipBot }) {

  // Step 14: order timeout cancels (best-effort)
  const _orderTimeouts = new Map(); // orderId -> timeoutId

  function scheduleOrderTimeout(orderId, { symbol = null, ms = 15000 } = {}) {
    const oid = String(orderId || "");
    if (!oid) return;
    if (_orderTimeouts.has(oid)) return;

    const timeoutMs = Math.max(1000, Number(ms) || 15000);

    const t = setTimeout(async () => {
      _orderTimeouts.delete(oid);
      try {
        const q = await rest.get("/v5/order/realtime", { category: "linear", symbol: symbol || undefined, orderId: oid });
        const o = q?.result?.list?.[0];
        const st = String(o?.orderStatus || o?.order_status || "");
        if (st && !["Filled", "Cancelled", "Rejected", "Deactivated"].includes(st)) {
          await rest.post("/v5/order/cancel", { category: "linear", symbol: symbol || o?.symbol, orderId: oid });
          logger?.log("order_timeout_cancel", { orderId: oid, symbol: symbol || o?.symbol, orderStatus: st });
        }
      } catch (e) {
        logger?.log("order_timeout_err", { orderId: oid, symbol, error: e?.message || String(e) });
      }
    }, timeoutMs);

    t.unref?.();
    _orderTimeouts.set(oid, t);
  }

  return {
    async ping() { return { ts: Date.now() }; },

    async getStatus(_payload, ctx) {
      return {
        serverTs: Date.now(),
        clientId: ctx.clientId,
        subscriptions: Array.from(ctx.subscriptions),
        bufferedBytes: ctx.ws.bufferedAmount,
        env: { name: BYBIT_CFG.env, tradeTransport: BYBIT_CFG.tradeTransport, httpBaseUrl: BYBIT_CFG.httpBaseUrl, wsPublicUrl: BYBIT_CFG.wsPublicUrl, wsPrivateUrl: BYBIT_CFG.wsPrivateUrl, wsTradeUrl: BYBIT_CFG.wsTradeUrl, safety: BYBIT_CFG.safety },
        feed: { running: !!feed.running, symbols: feed.symbols || [], stats: feed.getStats(), health: { bybit: { wsUp: feed.isWsUp?.() || false, lastMsgAgeMs: feed.lastWsMsgRecvTs ? (Date.now() - feed.lastWsMsgRecvTs) : null, reconnects: feed.reconnects || 0 }, binance: feed.getBinanceHealth?.() || null } },
        hub: hub.getStats(),
        leadLag: { latestTs: leadLag.latest?.ts ?? null, top: (leadLag.latest?.pairs || []).slice(0, 10) },
        privateWs: priv.getStats(),
        tradeWs: trade.getStats(),
        risk: { enableTrading: risk.enableTrading, haltTrading: risk.haltTrading, maxNotionalUSDT: risk.maxNotionalUSDT, orderTimeoutMs: risk.orderTimeoutMs, maxOpenOrders: risk.maxOpenOrders },
        tradeState: tradeState ? tradeState.summary() : null,
      paper: { params: strat.getParams(), state: paper.getState() },
      feedMaxSymbols: Number(process.env.FEED_MAX_SYMBOLS || 300),
      };
    },


    async demoApplyMoney(payload = {}, ctx) {
      // Demo Trading funds request: POST /v5/account/demo-apply-money
      // Requires DEMO API key/secret. Rate limit is very low (e.g. 1 req/min) per docs.
      if (BYBIT_CFG.env !== "demo") throw new Error("demoApplyMoney is only for BYBIT_ENV=demo");
      if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) throw new Error("Set BYBIT_API_KEY and BYBIT_API_SECRET (demo key)");

      const adjustType = Number(payload.adjustType ?? 0) || 0;
      const items = Array.isArray(payload.items) ? payload.items : [{ coin: "USDT", amountStr: "1000" }];
      const body = { adjustType, utaDemoApplyMoney: items };

      const resp = await rest.post("/v5/account/demo-apply-money", body);
      logger?.log("demo_apply_money", { retCode: resp?.retCode, retMsg: resp?.retMsg });
      try {
        await tradeState.reconcile(rest, { positions: false, orders: false, wallet: true });
        hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
      } catch {}
      return resp;
    },

    async subscribe(payload, ctx) {
      const topic = payload?.topic;
      if (!topic || typeof topic !== "string") throw new Error("subscribe: payload.topic must be a string");
      ctx.subscriptions.add(topic);
      hub.subscribe(ctx.ws, topic);
      logger?.log("rpc", { op: "subscribe", clientId: ctx.clientId, topic });

      if (topic === "paper") {
        hub.broadcast("paper", { ts: Date.now(), params: strat.getParams(), state: paper.getState() });
      }
      if (topic === "tradeState") {
        hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
      }
      return { subscribed: topic };
    },

    async unsubscribe(payload, ctx) {
      const topic = payload?.topic;
      if (!topic || typeof topic !== "string") throw new Error("unsubscribe: payload.topic must be a string");
      ctx.subscriptions.delete(topic);
      hub.unsubscribe(ctx.ws, topic);
      logger?.log("rpc", { op: "unsubscribe", clientId: ctx.clientId, topic });
      return { unsubscribed: topic };
    },

    async setSymbols(payload) {
      const symbols = payload?.symbols;
      const max = Number(process.env.FEED_MAX_SYMBOLS || 300);
      if (!Array.isArray(symbols) || symbols.length === 0) throw new Error("Необходимо указать список символов");
      if (symbols.length > max) throw new Error(`Превышен лимит символов: максимум ${max}`);
      feed.setSymbols(symbols.map((s) => String(s).toUpperCase()));
      logger?.log("rpc", { op: "setSymbols", symbols });
      return { symbols: feed.symbols || symbols, feedMaxSymbols: max };
    },

    async getUniverseFromRating(payload = {}) {
      const limit = Math.max(1, Math.min(100, Number(payload.limit) || 100));
      const minMarketCapUsd = Number(payload.minMarketCapUsd || 10_000_000);
      const symbols = await paperTest.cmc.getUniverseFromRating({ limit, minMarketCapUsd, listingsLimit: 500 });
      return { symbols, limit, minMarketCapUsd };
    },

    async getSymbolsFromRating(payload = {}) {
      const limit = Math.max(1, Math.min(100, Number(payload.limit) || 100));
      const minCapUsd = Number(payload.minCapUsd || payload.minMarketCapUsd || 10_000_000);
      const symbols = await paperTest.cmc.getUniverseFromRating({ limit, minMarketCapUsd: minCapUsd, listingsLimit: 500 });
      return { symbols, limit, minCapUsd };
    },

    async startFeed() { feed.start(); logger?.log("rpc", { op: "startFeed" }); return { running: true }; },
    async stopFeed() { feed.stop(); logger?.log("rpc", { op: "stopFeed" }); return { running: false }; },

    async getBars(payload) {
      const symbol = payload?.symbol;
      const nRaw = payload?.n ?? 240;
      if (!symbol || typeof symbol !== "string") throw new Error("getBars: payload.symbol must be string");
      const n = Math.max(0, Math.min(MAX_BARS_SNAPSHOT, Number(nRaw) || 0));
      return { symbol, bars: feed.getBars(symbol, n) };
    },

    async getKlines(payload = {}) {
      const symbol = String(payload.symbol || "").toUpperCase();
      if (!symbol) throw new Error("getKlines: payload.symbol required");
      const tfMap = { "5m": "5", "15m": "15", "1h": "60", "4h": "240" };
      const timeframe = String(payload.timeframe || "15m").toLowerCase();
      const interval = tfMap[timeframe] || "15";
      const limit = Math.max(10, Math.min(500, Number(payload.limit) || 200));
      const resp = await rest.marketKline({ category: "linear", symbol, interval, limit });
      const list = Array.isArray(resp?.result?.list) ? resp.result.list : [];
      const bars = list.map((row) => ({
        t: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        turnover: Number(row[6]),
      })).filter((x) => Number.isFinite(x.t)).sort((a,b)=>a.t-b.t);
      return { symbol, timeframe, bars };
    },

    async getLeadLag(payload) {
      const fresh = !!payload?.fresh;
      const topK = Math.max(1, Math.min(50, Number(payload?.topK) || 15));
      return fresh ? leadLag.computeNow({ topK }) : leadLag.latest;
    },

async refreshLeadLag(payload = {}) {
  // Force an immediate computation (frontend polls this every few seconds).
  const topK = Math.max(1, Math.min(50, Number(payload?.topK) || 15));
  const res = leadLag.computeNow({ topK });
  const top = (res?.pairs || []).slice(0, topK).map((p) => ({
    leader: p.leader,
    follower: p.follower,
    corr: p.corr,
    lagMs: p.bestLagMs,
    impulses: p.impulses,
    followerMeanAfterImpulse: p.followerMeanAfterImpulse,
    samples: p.samples,
  }));
  hub.broadcast("leadlag", { ts: Date.now(), top });
  return { ts: Date.now(), top };
},

    // Step 8 private/trade controls
    async connectPrivate() {
      logger?.log("connect_private_request", { env: BYBIT_CFG.env, url: BYBIT_CFG.wsPrivateUrl, hasKey: !!process.env.BYBIT_API_KEY, hasSecret: !!process.env.BYBIT_API_SECRET });
      if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) throw new Error("Set BYBIT_API_KEY and BYBIT_API_SECRET");
      priv.start();
      priv.setDesiredTopics(["order", "execution", "position", "wallet"]);

      // Wait briefly for auth, then reconcile state via REST snapshot (best-effort).
      const authed = await waitForAuthed(priv, { timeoutMs: 3500, pollMs: 50 });
      if (authed) {
        await tradeState.reconcile(rest, { positions: true, orders: true, wallet: true });
        hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
      }
      return { privateWs: priv.getStats(), tradeState: tradeState.summary() };
    },
    async disconnectPrivate() { priv.stop(); return priv.getStats(); },

    async connectTrade() {
      // In demo env we use REST polling; in testnet/mainnet we can later switch to WS.
      if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) throw new Error("Set BYBIT_API_KEY and BYBIT_API_SECRET");
      trade.start();
      return trade.getStats();
    },
    async disconnectTrade() { trade.stop(); return trade.getStats(); },

    async getPrivateStatus() {
      return { privateWs: priv.getStats(), tradeWs: trade.getStats(), risk: { enableTrading: risk.enableTrading, maxNotionalUSDT: risk.maxNotionalUSDT } };
    },

    async placeOrder(payload) {
      const params = {
        category: "linear",
        symbol: payload?.symbol,
        side: payload?.side,
        orderType: payload?.orderType || "Limit",
        qty: String(payload?.qty),
        timeInForce: payload?.timeInForce || "GTC",
      };
      if (params.orderType === "Limit") params.price = String(payload?.price);
      if (payload?.reduceOnly != null) params.reduceOnly = Boolean(payload.reduceOnly);


      // Preflight: enforce lot size / tick size using instruments-info (public, cached)
      const rules = await getInstrumentRules(params.symbol).catch(() => null);
      if (rules) {
        const minQty = rules.minQty;
        const qtyStep = rules.qtyStep;
        const tickSize = rules.tickSize;

        let q = Number(params.qty);
        let p = params.orderType === "Limit" ? Number(params.price) : null;

        if (Number.isFinite(minQty) && minQty > 0 && q < minQty) {
          throw new Error(`qty too small for ${params.symbol}: ${q} < minQty ${minQty}`);
        }

        if (Number.isFinite(qtyStep) && qtyStep > 0) {
          const q2 = roundToStep(q, qtyStep, "floor");
          if (Number.isFinite(q2) && q2 > 0 && q2 !== q) {
            logger?.log("order_qty_rounded", { symbol: params.symbol, from: q, to: q2, qtyStep });
            q = q2;
            params.qty = String(q2);
          }
        }

        if (params.orderType === "Limit" && Number.isFinite(tickSize) && tickSize > 0 && Number.isFinite(p) && p > 0) {
          const p2 = roundToStep(p, tickSize, "nearest");
          if (Number.isFinite(p2) && p2 > 0 && p2 !== p) {
            logger?.log("order_price_rounded", { symbol: params.symbol, from: p, to: p2, tickSize });
            p = p2;
            params.price = String(p2);
          }

          // Friendly message if maxNotional is below the exchange minimum notional implied by minQty
          const maxNotional = Number(process.env.MAX_NOTIONAL_USDT || risk.maxNotionalUSDT || 0);
          if (Number.isFinite(maxNotional) && maxNotional > 0 && Number.isFinite(minQty) && minQty > 0) {
            const minNotional = minQty * p2;
            if (Number.isFinite(minNotional) && minNotional > maxNotional) {
              throw new Error(`MAX_NOTIONAL_USDT too low for ${params.symbol}: need >= ${minNotional.toFixed(2)} (minQty ${minQty} @ price ${p2})`);
            }
          }
        }

        logger?.log("instrument_rules", { symbol: params.symbol, minQty, qtyStep, tickSize });
      }

      risk.validateOrderCreate({
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType,
        qty: Number(params.qty),
        price: params.orderType === "Limit" ? Number(params.price) : null,
        category: params.category,
      });

      if (BYBIT_CFG.tradeTransport === "rest") {
        // Demo trading: REST order.create (WS Trade is not supported)
        const resp = await orderCreateWithPositionIdxFallback(rest, params, logger);
        logger?.log("order_create_rest", { symbol: params.symbol, side: params.side, orderType: params.orderType, retCode: resp?.retCode, retMsg: resp?.retMsg });
        // keep UI state fresh in demo env (private WS can lag)
        try {
          await tradeState.reconcile(rest, { positions: true, orders: true, wallet: false });
          hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
        } catch {}
        return resp;
      }

      trade.start();
      const ack = await trade.orderCreate(params, { timeoutMs: 5000 });
      logger?.log("order_create_ack", { symbol: params.symbol, side: params.side, orderType: params.orderType, ack });
      return ack;
    },

    async placeBracket(payload = {}, ctx) {
      const symbol = String(payload.symbol || "").trim();
      const side = String(payload.side || "Buy");
      const qtyUSDT = Number(payload.qtyUSDT ?? payload.notionalUSDT ?? 25);
      const tpPct = Number(payload.tpPct ?? 0.6); // percent
      const slPct = Number(payload.slPct ?? 0.4); // percent
      const triggerBy = String(payload.triggerBy || "MarkPrice"); // MarkPrice|LastPrice|IndexPrice
      if (!symbol) throw new Error("symbol required");

      // need a reference price
      const mid = feed.getMid(symbol);
      if (!Number.isFinite(mid) || mid <= 0) throw new Error(`no mid price for ${symbol} (startFeed + subscribe price/bar first)`);

      const rules = await getInstrumentRules(symbol);
      const tick = rules?.tickSize ? Number(rules.tickSize) : null;
      const qStep = rules?.qtyStep ? Number(rules.qtyStep) : null;
      const minQty = rules?.minQty ? Number(rules.minQty) : null;

      // qty from USDT notional
let qty = qtyUSDT / mid;
if (qStep) qty = roundToStep(qty, qStep, "floor");

if (!Number.isFinite(qty) || qty <= 0) {
  const need = (minQty && Number.isFinite(minQty)) ? (minQty * mid) : null;
  throw new Error(need ? `qtyUSDT too low for ${symbol}: need >= ${need.toFixed(2)} USDT (minQty ${minQty})` : "qty computed <= 0");
}
if (minQty && qty < minQty) {
  const need = minQty * mid;
  throw new Error(`qtyUSDT too low for ${symbol}: need >= ${need.toFixed(2)} USDT (minQty ${minQty})`);
}

const estNotional = qty * mid;
      risk.validateOrderCreate({ symbol, side, orderType: "Market", qty, price: null, estNotional });

      // Compute TP/SL price levels around mid
      const sign = side === "Buy" ? 1 : -1;
      let tp = mid * (1 + sign * (tpPct / 100));
      let sl = mid * (1 - sign * (slPct / 100));

      if (tick) {
        tp = roundToStep(tp, tick, side === "Buy" ? "floor" : "ceil"); // conservative
        sl = roundToStep(sl, tick, side === "Buy" ? "ceil" : "floor");
      }

      const params = {
        category: "linear",
        symbol,
        side,
        orderType: "Market",
        qty: qStep ? fmtStep(qty, qStep) : String(qty),
        timeInForce: "IOC",
        // attach bracket
        takeProfit: String(tp),
        stopLoss: String(sl),
        tpTriggerBy: triggerBy,
        slTriggerBy: triggerBy,
        tpslMode: "Full",
        reduceOnly: false,
      };

      const resp = await orderCreateWithPositionIdxFallback(rest, params, logger);

      // schedule timeout cancel (best-effort) for unfilled orders
      try {
        const oid = resp?.result?.orderId || resp?.result?.order_id;
        if (oid && risk.orderTimeoutMs > 0) {
          scheduleOrderTimeout(String(oid), { symbol, ms: risk.orderTimeoutMs });
        }
      } catch {}

      try {
        await tradeState.reconcile(rest, { positions: true, orders: true, wallet: false });
        hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
      } catch {}

      return resp;
    },

    async cancelAll(payload = {}) {
  if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) throw new Error("Set BYBIT_API_KEY and BYBIT_API_SECRET");
  const symbol = payload?.symbol ? String(payload.symbol).toUpperCase() : null;

  const symbols = symbol
    ? [symbol]
    : (Array.isArray(feed.symbols) && feed.symbols.length ? feed.symbols.slice(0, 5) : ["BTCUSDT"]);

  const results = [];
  for (const sym of symbols) {
    const body = { category: "linear", symbol: sym };
    const resp = await rest.post("/v5/order/cancel-all", body);
    results.push({ symbol: sym, retCode: resp?.retCode, retMsg: resp?.retMsg, result: resp?.result });
    logger?.log("cancel_all", { symbol: sym, retCode: resp?.retCode, retMsg: resp?.retMsg });
  }

  return { retCode: 0, retMsg: "OK", results };
},

    async closeAll(payload = {}) {
      if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) throw new Error("Set BYBIT_API_KEY and BYBIT_API_SECRET");
      const symbolFilter = payload?.symbol ? String(payload.symbol) : null;

      const positions = tradeState?.getPositions?.() || [];
      const out = [];
      for (const p of positions) {
        const sym = String(p?.symbol || "");
        if (!sym) continue;
        if (symbolFilter && sym !== symbolFilter) continue;

        const size = Number(p?.size ?? p?.positionSize ?? p?.qty ?? 0);
        if (!Number.isFinite(size) || size === 0) continue;

        const idx = Number(p?.positionIdx ?? 0);
        const sideOpen = String(p?.side || (idx === 2 ? "Sell" : "Buy"));
        const sideClose = sideOpen === "Buy" ? "Sell" : "Buy";

        const rules = await getInstrumentRules(sym);
        const qStep = rules?.qtyStep ? Number(rules.qtyStep) : null;
        const minQty = rules?.minQty ? Number(rules.minQty) : null;

        let qty = Math.abs(size);
        if (qStep) qty = roundToStep(qty, qStep, "floor");
        if (minQty && qty < minQty) continue;

        const params = {
          category: "linear",
          symbol: sym,
          side: sideClose,
          orderType: "Market",
          qty: qStep ? fmtStep(qty, qStep) : String(qty),
          timeInForce: "IOC",
          reduceOnly: true,
          closeOnTrigger: true,
          positionIdx: idx,
        };

        try {
          const r = await rest.post("/v5/order/create", params);
          out.push({ symbol: sym, positionIdx: idx, ok: true, retCode: r?.retCode, retMsg: r?.retMsg, orderId: r?.result?.orderId });
        } catch (e) {
          out.push({ symbol: sym, positionIdx: idx, ok: false, error: e?.message || String(e) });
        }
      }

      logger?.log("close_all", { symbol: symbolFilter || "*", n: out.length, ok: out.filter((x) => x.ok).length });
      try {
        await tradeState.reconcile(rest, { positions: true, orders: true, wallet: false });
        hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
      } catch {}
      return { ok: true, results: out };
    },


    async getOpenOrders() { return tradeState.getOpenOrders(); },
    async cancelAllOrders(payload = {}) {
      const symbol = payload?.symbol ? String(payload.symbol).toUpperCase() : null;
      const symbols = symbol ? [symbol] : (Array.isArray(feed.symbols) && feed.symbols.length ? feed.symbols.slice(0, 5) : ["BTCUSDT"]);
      const results = [];
      for (const sym of symbols) {
        const resp = await rest.post("/v5/order/cancel-all", { category: "linear", symbol: sym });
        results.push({ symbol: sym, retCode: resp?.retCode, retMsg: resp?.retMsg, result: resp?.result });
      }
      return { retCode: 0, retMsg: "OK", results };
    },
    async closeAllPositions(payload = {}) {
      const positions = tradeState?.getPositions?.() || [];
      const out = [];
      for (const p of positions) {
        const sym = String(p?.symbol || "");
        const size = Number(p?.size ?? 0);
        if (!sym || !Number.isFinite(size) || size === 0) continue;
        const sideClose = String(p?.side || "Buy") === "Buy" ? "Sell" : "Buy";
        const resp = await orderCreateWithPositionIdxFallback(rest, { category: "linear", symbol: sym, side: sideClose, orderType: "Market", qty: String(Math.abs(size)), reduceOnly: true, timeInForce: "IOC" }, logger);
        out.push({ symbol: sym, ok: resp?.retCode === 0, retCode: resp?.retCode, retMsg: resp?.retMsg });
      }
      return { ok: true, results: out };
    },

    async killSwitch(payload = {}) {
      const on = payload?.on !== undefined ? !!payload.on : true;
      const reason = String(payload?.reason || "");
      risk.setHalt(on, reason);
      // best-effort: cancel all orders when killing
      if (on) {
        try { await rest.post("/v5/order/cancel-all", { category: "linear" }); } catch {}
      }
      return { ok: true, haltTrading: risk.haltTrading };
    },



    // Step 13 trade state (private WS + REST snapshots)
    async getTradeState(payload) {
      const maxOrders = Number(payload?.maxOrders ?? 50);
      const maxExecutions = Number(payload?.maxExecutions ?? 30);
      return tradeState.snapshot({ maxOrders, maxExecutions });
    },
    async reconcileTradeState() {
      const ok = await tradeState.reconcile(rest, { positions: true, orders: true, wallet: true });
      hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
      return { ok, summary: tradeState.summary() };
    },

    async startTrading(payload = {}) {
      const mode = payload?.mode || "demo";
      const params = payload?.params || {};
      if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) throw new Error("Не указаны ключи BYBIT_API_KEY/BYBIT_API_SECRET");
      if (mode === "real" && process.env.BYBIT_ALLOW_MAINNET !== "1") throw new Error("Реальная торговля не разрешена (установите BYBIT_ALLOW_MAINNET=1)");
      if (!feed.running) {
        const symbols = await (new SymbolUniverse({ bybitRest: rest, logger })).getTopUSDTPerps({ count: 30, minMarketCapUsd: 10_000_000 });
        feed.setSymbols(symbols);
        feed.start();
      }
      process.env.ENABLE_TRADING = "1";
      risk.setHalt(false);
      liveTrader.start({ mode, params });
      return { trading: true, mode, paramsApplied: true };
    },

    async stopTrading() {
      liveTrader.stop();
      risk.setHalt(true, "stopTrading");
      process.env.ENABLE_TRADING = "0";
      return { trading: false };
    },

    async getTradingStatus() {
      return liveTrader.status();
    },

    async createHedgeOrders(payload = {}) {
      const symbol = String(payload.symbol || "BTCUSDT").toUpperCase();
      const offsetPercent = Number(payload.offsetPercent ?? 1);
      const qtyUSDT = Number(payload.qtyUSDT ?? process.env.DEFAULT_QTY_USDT ?? 25);
      const tp = payload.takeProfit || { type: "roiPct", value: 1 };
      const sl = payload.stopLoss || { type: "roiPct", value: 2 };
      if (Number(sl.value) <= Number(tp.value)) throw new Error("Stop Loss должен быть больше Take Profit");
      const mid = feed.getMid(symbol);
      if (!Number.isFinite(mid) || mid <= 0) throw new Error("Нет цены для символа");

      const groupId = `HEDGE-${Date.now()}`;
      Promise.resolve().then(async () => {
        const rawQty = Math.max(0.001, qtyUSDT / mid);
        const qty = await normalizeQty(symbol, rawQty);
        const longTrigger = mid * (1 + offsetPercent / 100);
        const shortTrigger = mid * (1 - offsetPercent / 100);

        let leverage = 10;
        try {
          const posResp = await rest.get("/v5/position/list", { category: "linear", symbol });
          const firstPos = posResp?.result?.list?.[0] || {};
          const parsedLev = Number(firstPos.leverage);
          if (Number.isFinite(parsedLev) && parsedLev > 0) leverage = parsedLev;
        } catch (e) {
          logger?.log("hedge_leverage_fallback", { symbol, leverage, error: String(e?.message || e) });
        }

        const mkTpSl = (entry, side) => {
          const tpType = tp.type || "roiPct";
          const slType = sl.type || "roiPct";
          const isBuy = side === "Buy";
          const tpDelta = tpType === "pnlUSDT" ? (Number(tp.value) / Number(qty || 1)) : entry * ((Number(tp.value) / Math.max(leverage, 1)) / 100);
          const slDelta = slType === "pnlUSDT" ? (Number(sl.value) / Number(qty || 1)) : entry * ((Number(sl.value) / Math.max(leverage, 1)) / 100);
          return isBuy ? { takeProfit: String(entry + tpDelta), stopLoss: String(entry - slDelta) } : { takeProfit: String(entry - tpDelta), stopLoss: String(entry + slDelta) };
        };

        await orderCreateWithPositionIdxFallback(rest, {
          category: "linear", symbol, side: "Buy", orderType: "Market", qty: String(qty), triggerPrice: String(longTrigger), triggerDirection: 1, triggerBy: "MarkPrice", orderLinkId: `${groupId}-LONG`, ...mkTpSl(longTrigger, "Buy"),
        }, logger);
        await orderCreateWithPositionIdxFallback(rest, {
          category: "linear", symbol, side: "Sell", orderType: "Market", qty: String(qty), triggerPrice: String(shortTrigger), triggerDirection: 2, triggerBy: "MarkPrice", orderLinkId: `${groupId}-SHORT`, ...mkTpSl(shortTrigger, "Sell"),
        }, logger);

        await tradeState.reconcile(rest, { positions: true, orders: true, wallet: false });
        hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
      }).catch((e) => {
        const error = String(e?.message || e);
        logger?.log("hedge_create_error", { symbol, groupId, error });
        hub.broadcast("hedge", { ts: Date.now(), groupId, symbol, error, hint: error.includes("10001") ? "position idx not match position mode" : undefined });
      });

      return { ok: true, queued: true, groupId };
    },

    // Step 9 paper
    async paperStart(payload) {
      strat.setParams(payload || {});
      strat.enable(true);
      hub.broadcast("paper", { ts: Date.now(), params: strat.getParams(), state: paper.getState() });
      return { ok: true, params: strat.getParams(), state: paper.getState() };
    },
    async paperStop() {
      strat.enable(false);
      hub.broadcast("paper", { ts: Date.now(), params: strat.getParams(), state: paper.getState() });
      return { ok: true, params: strat.getParams(), state: paper.getState() };
    },


// Step 16: 8h paper test runner (hourly rotating presets)
async startPaperTest(payload) {
  const durationHours = Number(payload?.durationHours || 8);
  const rotateEveryMinutes = Number(payload?.rotateEveryMinutes || 60);
  const symbolsCount = Number(payload?.symbolsCount || 100);
  const minMarketCapUsd = Number(payload?.minMarketCapUsd || 10_000_000);
  const presets = Array.isArray(payload?.presets) ? payload.presets : null;
  const multiStrategy = !!payload?.multiStrategy;
  const exploitBest = !!payload?.exploitBest;
  const testOnlyPresetName = payload?.testOnlyPresetName ? String(payload.testOnlyPresetName) : null;
  const useBybit = payload?.useBybit !== false;
  const useBinance = payload?.useBinance !== false;
  const debugAllowEntryWithoutImpulse = !!payload?.debugAllowEntryWithoutImpulse;
  const debugEntryCooldownMin = Math.max(1, Number(payload?.debugEntryCooldownMin || 45));

  Promise.resolve().then(async () => {
    await paperTest.start({ durationHours, rotateEveryMinutes, symbolsCount, minMarketCapUsd, presets, multiStrategy, exploitBest, testOnlyPresetName, useBybit, useBinance, debugAllowEntryWithoutImpulse, debugEntryCooldownMin });
    hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 50 }));
  }).catch((e) => {
    logger?.log("paper_test_start_error", { error: String(e?.message || e) });
  });

  return { ok: true, queued: true };
},

async stopPaperTest(payload) {
  const reason = payload?.reason || "user";
  return await paperTest.stop(reason);
},

async resetLearning() {
  return paperTest.resetLearning();
},

async getPaperTestStatus() {
  return paperTest.getStatus();
},

async startRangeMetrics(payload = {}) {
  Promise.resolve().then(async () => {
    await rangeRunner.start(payload || {});
  }).catch((e) => logger?.log("range_start_err", { error: e?.message || String(e) }));
  return { ok: true, queued: true, state: rangeRunner.status().state };
},

async stopRangeMetrics() {
  return { ok: true, status: rangeRunner.stop() };
},

async getRangeMetricsStatus() {
  return rangeRunner.status();
},

async setRangeMetricsConfig(payload = {}) {
  const config = rangeRunner.setConfig(payload || {});
  hub.broadcast("rangeMetrics", { kind: "configUpdated", ts: Date.now(), payload: config });
  return { ok: true, config };
},

async getRangeMetricsCandidates() {
  return { candidates: rangeRunner.getCandidates() };
},

async startBoundaryFlipBot(payload = {}) {
  Promise.resolve().then(async () => {
    await boundaryFlipBot.start(payload || {});
  }).catch((e) => logger?.log("boundary_flip_start_err", { error: e?.message || String(e) }));
  return { ok: true, queued: true };
},

async stopBoundaryFlipBot() {
  return { ok: true, status: boundaryFlipBot.stop() };
},

async getBoundaryFlipBotStatus() {
  return boundaryFlipBot.getStatus();
},

async listPresets() {
  return { presets: paperTest.listPresets(), presetStats: paperTest.presetStats || {} };
},

async savePreset(payload = {}) {
  const body = payload?.preset || payload || {};
  const routeName = String(payload?.name || body?.name || "").trim();
  const hasName = String(body?.name || "").trim();
  const preset = (!hasName && routeName)
    ? paperTest.updatePreset(routeName, body)
    : paperTest.upsertPreset(body);
  return { preset, presets: paperTest.listPresets() };
},

async deletePreset(payload = {}) {
  const name = String(payload?.name || "");
  return { presets: paperTest.deletePreset(name) };
},

    async paperReset() {
      paper.reset();
      hub.broadcast("paper", { ts: Date.now(), params: strat.getParams(), state: paper.getState() });
      return { ok: true, params: strat.getParams(), state: paper.getState() };
    },
    async paperState() { return { params: strat.getParams(), state: paper.getState() }; },
  };
}

function setupWebSocketServer(server) {
  const wss = new WebSocketServer({ server });
  const logger = new JsonlLogger();
  const rest = new BybitRestClient({ baseUrl: BYBIT_CFG.httpBaseUrl, logger });
const hub = new WsHub({ maxBuffered: MAX_BUFFERED_BYTES, logger });

  const tradeState = new TradeState({ logger });

  const feed = new FeedManager({
    barMs: 250,
    maxBarSeconds: 120,
    broadcast: (topic, payload) => hub.broadcast(topic, payload),
    logger,
  });
  feed.setSymbols(DEFAULT_SYMBOLS);
  HTTP_CTX.feed = feed;

  const leadLag = new LeadLagService({ feed, hub, logger, intervalMs: 2000, windowBars: 240, maxLagBars: 20, minBars: 120 });
  leadLag.start();

  const priv = new PrivateWsClient({
    url: BYBIT_CFG.wsPrivateUrl,
    logger,
    onEvent: (topic, msg) => {
      hub.broadcast(`priv.${topic}`, msg);
      logger.log("priv_ws_msg", { topic, creationTime: msg?.creationTime, hasData: !!msg?.data });

      // Step 13: keep reconciled trade state
      const changed = tradeState.applyPrivate(topic, msg);
      if (changed) {
        // throttle broadcasts to UI
        const now = Date.now();
        if (!tradeState._lastBroadcastTs || (now - tradeState._lastBroadcastTs) > 400) {
          tradeState._lastBroadcastTs = now;
          hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
        }
      }
    },
  });

  const trade = new TradeTransport({ rest, tradeState, hub, logger });
const risk = new RiskManager({ allowSymbols: DEFAULT_SYMBOLS, logger });

  const paper = new PaperBroker({ startingBalanceUSDT: 1000, feeBps: 6, logger });
  const strat = new LeadLagPaperStrategy({ feed, leadLag, broker: paper, hub, logger });  

const universe = new SymbolUniverse({ bybitRest: rest, logger });
const paperTest = new PaperTestRunner({ feed, strategy: strat, broker: paper, hub, universe, logger, leadLag, rest });
  const instruments = { normalizeQty };
  const liveTrader = new LeadLagLiveTrader({ feed, leadLag, rest, risk, instruments, logger });
  const rangeRunner = new RangeMetricsRunner({ feed, rest, hub, logger, risk });
  const boundaryExecutor = new BoundaryExecutorAdapter({ rest, logger });
  const boundaryTracker = new CycleTracker({ rest, executor: boundaryExecutor, logger });
  const boundaryFlipBot = new BoundaryFlipBotRunner({ hub, logger, executor: boundaryExecutor, tracker: boundaryTracker });

  (async () => {
    try {
      const top = await universe.getTopUSDTPerps({ count: 100, minMarketCapUsd: 10_000_000 });
      if (Array.isArray(top) && top.length) {
        feed.setSymbols(top);
        risk.allowSymbols = [...top];
        logger.log("default_symbols_bootstrap", { count: top.length, symbols: top });
      }
    } catch (e) {
      logger.log("default_symbols_bootstrap_err", { error: String(e?.message || e) });
    }
  })();

  strat.start(); // timer
  // strat.enable(false) by default

  const handlers = makeHandlers({ hub, feed, leadLag, priv, trade, risk, paper, strat, tradeState, paperTest, logger, rest, liveTrader, rangeRunner, boundaryFlipBot });


// Step 15: keep TradeState in sync even when private WS lags (demo env)
const TRADE_STATE_POLL_MS = Math.max(500, Number(process.env.TRADE_STATE_POLL_MS || 2500));
let _tradeStatePollBusy = false;
const _tradeStatePollTimer = setInterval(async () => {
  try {
    if (_tradeStatePollBusy) return;
    const ps = priv.getStats();
    const hs = hub.getStats();
    // If TradeTransport is already polling in REST mode, avoid duplicated REST load.
    const ts = trade.getStats();
    if (BYBIT_CFG.tradeTransport === "rest" && ts?.running) return;
    if (!ps?.authed) return;
    if (!hs?.clients || hs.clients <= 0) return;

    _tradeStatePollBusy = true;
    await tradeState.reconcile(rest, { positions: true, orders: true, wallet: false });
    hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
  } catch (e) {
    logger?.log("trade_state_poll_err", { error: e?.message || String(e) });
  } finally {
    _tradeStatePollBusy = false;
  }
}, TRADE_STATE_POLL_MS);
_tradeStatePollTimer.unref?.();


  wss.on("connection", (ws, req) => {
    hub.add(ws);

    const ctx = {
      ws,
      clientId: crypto.randomUUID?.() || String(Date.now()),
      subscriptions: new Set(),
      userAgent: req.headers["user-agent"] ?? null,
    };

    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    sendEvent(ws, "hello", { clientId: ctx.clientId, serverTs: Date.now(), ua: ctx.userAgent });
    logger.log("ws_client", { op: "connect", clientId: ctx.clientId, ua: ctx.userAgent });

    Promise.resolve().then(async () => {
      try {
        if (priv.getStats()?.authed) {
          await tradeState.reconcile(rest, { positions: true, orders: true, wallet: true });
          hub.broadcast("tradeState", tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));
        }
      } catch (e) {
        logger.log("trade_state_reconcile_on_connect_err", { error: e?.message || String(e) });
      }
    });

    const metricsTimer = startMetricsTicker(ctx, feed, hub, leadLag, priv, trade, risk, paper, strat, tradeState, paperTest, logger);

    ws.on("message", async (buf) => {
      const parsed = safeJsonParse(buf.toString("utf8"));
      if (!parsed.ok) {
        sendEvent(ws, "error", { error: parsed.error });
        logger.log("error", { scope: "parse", error: parsed.error });
        return;
      }

      const { type, id, payload } = parsed.value || {};
      if (typeof type !== "string" || typeof id !== "string") {
        sendEvent(ws, "error", { error: "Message must have string type and id" });
        return;
      }

      const handler = handlers[type];
      if (!handler) { sendJson(ws, makeErr(id, `Unknown command: ${type}`)); return; }

      try {
        const result = await handler(payload, ctx);
        sendJson(ws, makeOk(id, result));
      } catch (e) {
        sendJson(ws, makeErr(id, e?.message || "Handler error"));
        logger.log("error", { scope: "rpc", type, error: e?.message || "Handler error" });
      }
    });

    ws.on("close", () => {
      clearInterval(metricsTimer);
      hub.remove(ws);
      logger.log("ws_client", { op: "close", clientId: ctx.clientId });
    });

    ws.on("error", (e) => logger.log("error", { scope: "ws_client", error: e?.message || "ws error" }));
  });

  function shutdown() {
    logger.log("shutdown", {});
    try { leadLag.stop(); } catch {}
    try { feed.stop(); } catch {}
    try { priv.stop(); } catch {}
    try { trade.stop(); } catch {}
    try { strat.stop(); } catch {}
    try { logger.close(); } catch {}
    try { server.close(() => process.exit(0)); } catch { process.exit(0); }
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return wss;
}

function startHeartbeat(wss, intervalMs = 15000) {
  return setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, intervalMs);
}

function main() {
  const server = createHttpServer();
  const wss = setupWebSocketServer(server);
  const heartbeatTimer = startHeartbeat(wss, 15000);

  server.listen(PORT, () => console.log(`WS server listening on http://localhost:${PORT}`));
  heartbeatTimer.unref?.();
}

main();
