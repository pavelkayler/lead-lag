import WebSocket from "ws";
import { RingBuffer } from "./ringBuffer.js";
import { resolveBybitConfig } from "../exchange/bybitEnv.js";

export class FeedManager {
  constructor({ tickMs = 100, barMs = 250, maxBarSeconds = 120, broadcast, logger = null, wsUrl = null } = {}) {
    this.tickMs = tickMs;
    this.barMs = barMs;
    this.maxBars = Math.max(1, Math.floor((maxBarSeconds * 1000) / barMs));
    this.broadcast = broadcast;
    this.logger = logger;

    this.mode = "ws"; // "ws" | "replay"


    const cfg = resolveBybitConfig();

    this.wsUrl = wsUrl || process.env.BYBIT_PUBLIC_WS_URL || cfg.wsPublicUrl;
    this.binanceWsUrl = process.env.BINANCE_SPOT_WS_URL || "wss://stream.binance.com:9443/ws/!bookTicker";
    this._binanceWsMode = "bookTickerAll";

    // Public REST (no auth) used as a sanity reference for prices (helps detect rare WS scale glitches)
    this.publicHttpBaseUrl = process.env.BYBIT_PUBLIC_HTTP_URL || "https://api.bybit.com";
    this._restRef = new Map(); // symbol -> { ts, last, mark, index }
    this._restTimer = null;

    this.symbols = [];
    this.running = false;

    this.state = new Map(); // key(symbol|source) -> { mid, prevBarMid, lastTickRecvTs, lastTickExchTs, lastTickLoggedTs }
    this.bars = new Map();  // key(symbol|source) -> RingBuffer

    this._barTimer = null;

    this._ws = null;
    this._bnWs = null;
    this._wsPingTimer = null;
    this._bnWsPingTimer = null;
    this._reconnectTimer = null;
    this._bnReconnectTimer = null;
    this._reconnectDelayMs = 500;
    this._bnReconnectDelayMs = 500;
    this._subscribedTopics = new Set();
    this.tickersSnapshot = new Map(); // symbol -> ticker fields
    this.trades = new Map(); // symbol -> [{ts,side,size,price}]
    this.liquidations = new Map(); // symbol -> [{ts, side, size, price}]

    this.reconnects = 0;
    this.binanceReconnects = 0;
    this.lastWsMsgRecvTs = null;
    this.lastBnWsMsgRecvTs = null;
    this.lastWsOpenTs = null;
    this.lastWsCloseTs = null;
    this.lastBnWsOpenTs = null;
    this.lastBnWsCloseTs = null;
    this.lastBnWsError = null;
    this._bnMsgCount = 0;
    this._bnMsgLastSecTs = Date.now();
    this._bnMappedSinceOpen = 0;
    this._bnFiltered = { nonUsdt: 0, notWhitelisted: 0, invalidPayload: 0, invalidNumbers: 0 };
    this._bnFilterLastLogTs = 0;
    this._bnFallbackAttempted = false;
    this._bnDegradeLastLogTs = 0;

    this.tickLogSampleMs = Number(process.env.FEED_TICK_LOG_SAMPLE_MS) || 1000;
    this.latWin = Math.max(100, Number(process.env.LATENCY_WINDOW) || 2000);

    this._barLatency = [];
    this._wsDelay = [];
  }


  async _refreshRestRefs() {
    try {
      const syms = Array.isArray(this.symbols) ? this.symbols.slice(0, 5) : [];
      if (!syms.length) return;

      const base = String(this.publicHttpBaseUrl || "https://api.bybit.com").replace(/\/+$/, "");
      const reqs = syms.map(async (symbol) => {
        const url = `${base}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`;
        const res = await fetch(url);
        const json = await res.json().catch(() => null);
        const item = json?.result?.list?.[0];
        if (!item) return;
        const last = Number(item.lastPrice);
        const mark = Number(item.markPrice);
        const index = Number(item.indexPrice);
        const ts = Date.now();
        this._restRef.set(symbol, {
          ts,
          last: Number.isFinite(last) ? last : null,
          mark: Number.isFinite(mark) ? mark : null,
          index: Number.isFinite(index) ? index : null,
        });
      });

      await Promise.allSettled(reqs);
    } catch {
      // ignore (best-effort)
    }
  }

  isWsUp() {
    return !!(this._ws && this._ws.readyState === WebSocket.OPEN);
  }

  isBinanceWsUp() {
    return !!(this._bnWs && this._bnWs.readyState === WebSocket.OPEN);
  }

  _seriesKey(symbol, source = "BT") {
    return `${String(symbol || "").toUpperCase()}|${String(source || "BT").toUpperCase()}`;
  }

  _ensureSeries(symbol, source = "BT") {
    const key = this._seriesKey(symbol, source);
    if (!this.state.has(key)) this.state.set(key, { mid: null, prevBarMid: null, lastTickRecvTs: null, lastTickExchTs: null, lastTickLoggedTs: 0 });
    if (!this.bars.has(key)) this.bars.set(key, new RingBuffer(this.maxBars));
    return key;
  }

  getStats() {
    const now = Date.now();
    return {
      mode: this.mode,
      wsUp: this.isWsUp(),
      binanceWsUp: this.isBinanceWsUp(),
      wsUrl: this.wsUrl,
      binanceWsUrl: this.binanceWsUrl,
      reconnects: this.reconnects,
      binanceReconnects: this.binanceReconnects,
      lastWsMsgAgeMs: this.lastWsMsgRecvTs ? (now - this.lastWsMsgRecvTs) : null,
      lastBinanceWsMsgAgeMs: this.lastBnWsMsgRecvTs ? (now - this.lastBnWsMsgRecvTs) : null,
      binance: this.getBinanceHealth(),
      barLatency: this._percentiles(this._barLatency),
      wsDelay: this._percentiles(this._wsDelay),
    };
  }

  getBinanceHealth() {
    const now = Date.now();
    const mappedSymbolsCount = this.symbols.reduce((acc, symbol) => {
      const st = this.state.get(this._seriesKey(symbol, "BNB"));
      return acc + (Number.isFinite(st?.mid) ? 1 : 0);
    }, 0);
    return {
      wsUp: this.isBinanceWsUp(),
      wsMode: this._binanceWsMode,
      wsUrl: this._currentBinanceWsUrl(),
      lastMsgAgeMs: this.lastBnWsMsgRecvTs ? (now - this.lastBnWsMsgRecvTs) : null,
      lastError: this.lastBnWsError,
      reconnects: this.binanceReconnects,
      subscribedSymbolsCount: this.symbols.length,
      mappedSymbolsCount,
      mappedSinceOpen: this._bnMappedSinceOpen,
      filtered: { ...this._bnFiltered },
      status: this._calcBinanceStatus(),
    };
  }

  _calcBinanceStatus() {
    if (!this.isBinanceWsUp()) return "DOWN";
    const age = this.lastBnWsMsgRecvTs ? (Date.now() - this.lastBnWsMsgRecvTs) : null;
    if (age == null || age > 10000) return "STALE";
    return "OK";
  }

  setSymbols(symbols) {
    const uniq = [...new Set((symbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean))].slice(0, 300);
    this.symbols = uniq;

    for (const s of uniq) {
      this._ensureSeries(s, "BT");
      this._ensureSeries(s, "BNB");
    }
    for (const k of [...this.state.keys()]) {
      const [sym] = String(k).split("|");
      if (!uniq.includes(sym)) this.state.delete(k);
    }
    for (const k of [...this.bars.keys()]) {
      const [sym] = String(k).split("|");
      if (!uniq.includes(sym)) this.bars.delete(k);
    }

    this._syncSubscriptions();
    this.logger?.log("bn_ws_symbols", { mode: this._binanceWsMode, count: this.symbols.length, preview: this.symbols.slice(0, 10) });
    this.logger?.log("symbols", { symbols: this.symbols });
  }

  start({ ws = true } = {}) {
    if (this.running) return;
    this.running = true;
    this.mode = ws ? "ws" : "replay";

    if (ws) {
      this._connectWs();
      this._connectBinanceWs();
    }
    this._barTimer = setInterval(() => this._onBar(), this.barMs);
    this._barTimer.unref?.();

    this.logger?.log("feed_start", { barMs: this.barMs, maxBars: this.maxBars });
  }


  startReplay() {
    return this.start({ ws: false });
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    clearInterval(this._barTimer);
    this._barTimer = null;

    this._cleanupWs(true);
    this._cleanupBinanceWs();
    this.logger?.log("feed_stop", {});
  }

  getBars(symbol, n, source = "BT") {
    const rb = this.bars.get(this._seriesKey(symbol, source));
    if (!rb) return [];
    return rb.tail(n);
  }

  getMid(symbol, source = "BT") {
    const st = this.state.get(this._seriesKey(symbol, source));
    let mid = st?.mid;

    // REST reference (best-effort) to correct scale issues even when mark/index are missing
    const rr = this._restRef.get(symbol);
    const restRef = rr?.last || rr?.mark || rr?.index || null;

    if (restRef && typeof mid === "number" && Number.isFinite(mid)) {
      mid = this._normalizeScale(mid, restRef);
    }

    return (typeof mid === "number" && Number.isFinite(mid)) ? mid : null;
  }

  getReturns(symbol, n, source = "BT") {
    const bars = this.getBars(symbol, n, source);
    const rs = [];
    for (const b of bars) {
      const v = Number(b?.r);
      if (Number.isFinite(v)) rs.push(v);
    }
    return rs;
  }

  getSymbolSources(symbol) {
    const out = [];
    for (const src of ["BT", "BNB"]) {
      const st = this.state.get(this._seriesKey(symbol, src));
      if (Number.isFinite(st?.mid)) out.push(src);
    }
    return out;
  }

  listSeries() {
    const all = [];
    for (const symbol of this.symbols) {
      for (const source of ["BT", "BNB"]) {
        this._ensureSeries(symbol, source);
        all.push({ symbol, source, key: this._seriesKey(symbol, source) });
      }
    }
    return all;
  }


  /**
   * ingestMid()
   * Used by replay (and can be used for synthetic feeds).
   * Updates internal state and broadcasts a "price" event identical to WS ticks.
   */
  ingestMid(symbol, mid, exchTs = null, recvTs = Date.now(), { source = "inject" } = {}) {
    const s = String(symbol || "");
    const m = Number(mid);
    if (!s) return;
    if (!Number.isFinite(m) || m <= 0) return;

    const src = String(source || "BT").toUpperCase();
    const st = this.state.get(this._seriesKey(s, src));
    if (!st) return;

    st.mid = m;
    st.lastTickRecvTs = recvTs;
    st.lastTickExchTs = (exchTs != null && Number.isFinite(Number(exchTs))) ? Number(exchTs) : null;

    // do not try to normalize scale here (replay file already stored mids). getMid() will still apply restRef scaling if enabled.
    this.broadcast("price", { ts: recvTs, t: recvTs, symbol: s, source: src, mid: m, exchTs: st.lastTickExchTs });

    // latency sample (treat like wsDelay)
    if (this.logger) {
      if ((recvTs - (st.lastTickLoggedTs || 0)) >= this.tickLogSampleMs) {
        st.lastTickLoggedTs = recvTs;
        const delayMs = (st.lastTickExchTs != null) ? (recvTs - st.lastTickExchTs) : null;
        this.logger.log("tick_inject_sample", { source, symbol: s, mid: m, recvTs, exchTs: st.lastTickExchTs, delayMs });
      }
    }
  }

  _connectWs() {
    if (!this.running) return;
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) return;

    this._ws = new WebSocket(this.wsUrl);

    this._ws.on("open", () => {
      this.lastWsOpenTs = Date.now();
      this._reconnectDelayMs = 500;
      this._syncSubscriptions(true);
      this.logger?.log("ws_state", { state: "open", url: this.wsUrl });

      this._wsPingTimer = setInterval(() => {
        if (this._ws?.readyState === WebSocket.OPEN) {
          try { this._ws.send(JSON.stringify({ op: "ping" })); } catch {}
        }
      }, 20000);
      this._wsPingTimer.unref?.();

      // Best-effort REST sanity reference refresh
      clearInterval(this._restTimer);
      this._refreshRestRefs();
      this._restTimer = setInterval(() => this._refreshRestRefs(), 10000);
      this._restTimer.unref?.();
    });

    this._ws.on("message", (raw) => {
      this.lastWsMsgRecvTs = Date.now();

      let msg;
      try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }

      if (msg?.op === "ping") {
        try { this._ws?.send(JSON.stringify({ op: "pong" })); } catch {}
        return;
      }

      const topic = msg?.topic;
      if (typeof topic !== "string") return;

      if (topic.startsWith("publicTrade.")) {
        const data = Array.isArray(msg?.data) ? msg.data : (msg?.data ? [msg.data] : []);
        for (const d of data) this._applyPublicTrade(topic, d);
        return;
      }

      if (topic.startsWith("allLiquidation.")) {
        const data = Array.isArray(msg?.data) ? msg.data : (msg?.data ? [msg.data] : []);
        for (const d of data) this._applyLiquidation(topic, d);
        return;
      }

      if (!topic.startsWith("tickers.")) return;

      const exchTs = Number(msg.ts ?? NaN);
      const data = msg.data;
      if (Array.isArray(data)) {
        for (const d of data) this._applyTicker(topic, d, exchTs, "BT");
      } else if (data) {
        this._applyTicker(topic, data, exchTs, "BT");
      }
    });

    const onDown = (why) => {
      this.lastWsCloseTs = Date.now();
      this.logger?.log("ws_state", { state: "down", why: String(why || ""), url: this.wsUrl });

      this._cleanupWs(false);
      if (!this.running) return;

      this.reconnects++;
      this._scheduleReconnect();
    };

    this._ws.on("close", () => onDown("close"));
    this._ws.on("error", (e) => onDown(e?.message || "error"));
  }

  _connectBinanceWs() {
    if (!this.running) return;
    if (this._bnWs && (this._bnWs.readyState === WebSocket.OPEN || this._bnWs.readyState === WebSocket.CONNECTING)) return;
    const url = this._currentBinanceWsUrl();
    this._bnWs = new WebSocket(url);

    this._bnWs.on("open", () => {
      this.lastBnWsOpenTs = Date.now();
      this._bnReconnectDelayMs = 500;
      this._bnMsgCount = 0;
      this._bnMsgLastSecTs = Date.now();
      this._bnMappedSinceOpen = 0;
      this._bnFallbackAttempted = false;
      this.logger?.log("bn_ws_state", { state: "open", url, mode: this._binanceWsMode, symbolsCount: this.symbols.length });
      this.logger?.log("bn_ws_subscribe", {
        mode: this._binanceWsMode,
        listening: this._binanceWsMode === "bookTickerAll" ? "!bookTicker" : "<symbols>@bookTicker",
        symbolsCount: this.symbols.length,
      });
      this._bnWsPingTimer = setInterval(() => {
        if (this._bnWs?.readyState === WebSocket.OPEN) {
          try { this._bnWs.ping(); } catch {}
        }
      }, 20000);
      this._bnWsPingTimer.unref?.();
    });

    this._bnWs.on("message", (raw) => {
      this.lastBnWsMsgRecvTs = Date.now();
      this._bnMsgCount += 1;
      if ((this.lastBnWsMsgRecvTs - this._bnMsgLastSecTs) >= 1000) {
        this.logger?.log("bn_ws_rate", { msgsPerSec: this._bnMsgCount, lastMsgTs: this.lastBnWsMsgRecvTs });
        this._bnMsgCount = 0;
        this._bnMsgLastSecTs = this.lastBnWsMsgRecvTs;
      }
      let msg;
      try { msg = JSON.parse(raw.toString("utf8")); } catch { this._bnFiltered.invalidPayload++; return; }
      const payload = msg?.data && typeof msg.data === "object" ? msg.data : msg;
      const symbol = String(payload?.s || "").toUpperCase();
      if (!symbol) {
        this._bnFiltered.invalidPayload++;
        return;
      }
      if (!symbol.endsWith("USDT")) {
        this._bnFiltered.nonUsdt++;
        this._logBnFilterStats();
        return;
      }
      if (!this.symbols.includes(symbol)) {
        this._bnFiltered.notWhitelisted++;
        this._logBnFilterStats();
        return;
      }
      const bid = Number(payload?.b);
      const ask = Number(payload?.a);
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
        this._bnFiltered.invalidNumbers++;
        this.logger?.log("bn_ws_invalid_book", { symbol, sample: payload });
        return;
      }
      this._bnMappedSinceOpen += 1;
      this._applyTicker(`bookTicker.${symbol}`, { symbol, bid1Price: bid, ask1Price: ask }, Number(payload?.E || NaN), "BNB");
    });

    const onDown = (why, extra = {}) => {
      this.lastBnWsCloseTs = Date.now();
      this.lastBnWsError = String(why || "");
      this.logger?.log("bn_ws_state", { state: "down", why: String(why || ""), url, mode: this._binanceWsMode, ...extra });
      this._cleanupBinanceWs();
      if (!this.running) return;
      this.binanceReconnects++;
      if (this._bnReconnectTimer) return;
      const delay = Math.min(15000, this._bnReconnectDelayMs);
      this._bnReconnectDelayMs = Math.min(15000, this._bnReconnectDelayMs * 2);
      this._bnReconnectTimer = setTimeout(() => {
        this._bnReconnectTimer = null;
        this._connectBinanceWs();
      }, delay);
      this._bnReconnectTimer.unref?.();
    };

    this._bnWs.on("close", (code, reason) => onDown("close", { code, reason: Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "") }));
    this._bnWs.on("error", (e) => onDown(e?.message || "error"));
  }

  _currentBinanceWsUrl() {
    if (this._binanceWsMode === "streamWhitelist") {
      const streams = this.symbols.slice(0, 150).map((s) => `${String(s).toLowerCase()}@bookTicker`);
      if (streams.length) return `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;
    }
    return this.binanceWsUrl;
  }

  _logBnFilterStats(force = false) {
    const now = Date.now();
    if (!force && (now - this._bnFilterLastLogTs) < 5000) return;
    this._bnFilterLastLogTs = now;
    this.logger?.log("bn_ws_filtered", { ...this._bnFiltered, whitelistCount: this.symbols.length });
  }


  _normalizeScale(mid, ref) {
    if (!Number.isFinite(mid) || mid <= 0) return mid;
    if (!Number.isFinite(ref) || ref <= 0) return mid;

    const ratio = mid / ref;

    // Fix common testnet/demo scale glitches (x10/x100 or inverse).
    if (ratio > 8 && ratio < 12) return mid / 10;
    if (ratio > 80 && ratio < 120) return mid / 100;
    if (ratio > 800 && ratio < 1200) return mid / 1000;

    if (ratio > 0.08 && ratio < 0.12) return mid * 10;
    if (ratio > 0.008 && ratio < 0.012) return mid * 100;
    if (ratio > 0.0008 && ratio < 0.0012) return mid * 1000;

    return mid;
  }

  _applyTicker(topic, d, exchTs, source = "BT") {
    const symbol = d?.symbol || topic.split(".")[1];
    if (!symbol) return;

    const bid = Number(d?.bid1Price);
    const ask = Number(d?.ask1Price);
    const last = Number(d?.lastPrice);
    const mark = Number(d?.markPrice);
    const index = Number(d?.indexPrice);

    let mid = null;
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) mid = (bid + ask) / 2;
    else if (Number.isFinite(last) && last > 0) mid = last;
    else return;

    // Use index/mark as a sanity reference to correct rare scale glitches (seen on some envs).
    const ref = (Number.isFinite(index) && index > 0) ? index : ((Number.isFinite(mark) && mark > 0) ? mark : null);
    if (ref) mid = this._normalizeScale(mid, ref);

    // REST reference (best-effort) to correct scale issues even when mark/index are missing
    const rr = this._restRef.get(symbol);
    const restRef = rr?.last || rr?.mark || rr?.index || null;
    if (restRef) mid = this._normalizeScale(mid, restRef);

    const st = this.state.get(this._seriesKey(symbol, source));
    if (!st) return;

    const recvTs = Date.now();
    st.mid = mid;
    st.lastTickRecvTs = recvTs;
    st.lastTickExchTs = Number.isFinite(exchTs) ? exchTs : null;

    this.tickersSnapshot.set(symbol, {
      ts: recvTs,
      symbol,
      source,
      lastPrice: Number.isFinite(last) ? last : null,
      markPrice: Number.isFinite(mark) ? mark : null,
      indexPrice: Number.isFinite(index) ? index : null,
      openInterest: Number.isFinite(Number(d?.openInterest)) ? Number(d.openInterest) : null,
      fundingRate: Number.isFinite(Number(d?.fundingRate)) ? Number(d.fundingRate) : null,
      nextFundingTime: Number.isFinite(Number(d?.nextFundingTime)) ? Number(d.nextFundingTime) : null,
      turnover24h: Number.isFinite(Number(d?.turnover24h)) ? Number(d.turnover24h) : null,
      volume24h: Number.isFinite(Number(d?.volume24h)) ? Number(d.volume24h) : null,
      bid1: Number.isFinite(bid) ? bid : null,
      ask1: Number.isFinite(ask) ? ask : null,
      spreadBps: Number.isFinite(bid) && Number.isFinite(ask) && mid > 0 ? ((ask - bid) / mid) * 10000 : null,
    });

    this.broadcast("price", { ts: recvTs, t: recvTs, symbol, source, mid, bid: Number.isFinite(bid) ? bid : undefined, ask: Number.isFinite(ask) ? ask : undefined, exchTs });

    if (this.logger) {
      if ((recvTs - (st.lastTickLoggedTs || 0)) >= this.tickLogSampleMs) {
        st.lastTickLoggedTs = recvTs;
        const wsDelayMs = (st.lastTickExchTs != null) ? (recvTs - st.lastTickExchTs) : null;
        this.logger.log("tick_sample", { symbol, source, mid, recvTs, exchTs: st.lastTickExchTs, wsDelayMs });
      }
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(15000, this._reconnectDelayMs);
    this._reconnectDelayMs = Math.min(15000, this._reconnectDelayMs * 2);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connectWs();
    }, delay);

    this._reconnectTimer.unref?.();
  }

  _cleanupWs(clearSubs) {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._wsPingTimer) {
      clearInterval(this._wsPingTimer);
      this._wsPingTimer = null;
    }
    if (this._ws) {
      try { this._ws.close(); } catch {}
      this._ws = null;
    }
    if (clearSubs) this._subscribedTopics.clear();
  }

  _cleanupBinanceWs() {
    if (this._bnReconnectTimer) {
      clearTimeout(this._bnReconnectTimer);
      this._bnReconnectTimer = null;
    }
    if (this._bnWsPingTimer) {
      clearInterval(this._bnWsPingTimer);
      this._bnWsPingTimer = null;
    }
    if (this._bnWs) {
      try { this._bnWs.close(); } catch {}
      this._bnWs = null;
    }
  }

  _syncSubscriptions(full = false) {
    const ws = this._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const desired = new Set();
    for (const s of this.symbols) {
      desired.add(`tickers.${s}`);
      desired.add(`publicTrade.${s}`);
      desired.add(`allLiquidation.${s}`);
    }
    const current = this._subscribedTopics;

    if (full && current.size) {
      try { ws.send(JSON.stringify({ op: "unsubscribe", args: Array.from(current) })); } catch {}
      current.clear();
    }

    const toUnsub = [];
    for (const t of current) if (!desired.has(t)) toUnsub.push(t);

    const toSub = [];
    for (const t of desired) if (!current.has(t)) toSub.push(t);

    if (toUnsub.length) {
      try { ws.send(JSON.stringify({ op: "unsubscribe", args: toUnsub })); } catch {}
      for (const t of toUnsub) current.delete(t);
      this.logger?.log("ws_sub", { op: "unsubscribe", args: toUnsub });
    }

    if (toSub.length) {
      try { ws.send(JSON.stringify({ op: "subscribe", args: toSub })); } catch {}
      for (const t of toSub) current.add(t);
      this.logger?.log("ws_sub", { op: "subscribe", args: toSub });
    }
  }

  _pushRoll(arr, v) {
    if (!Number.isFinite(v)) return;
    arr.push(v);
    if (arr.length > this.latWin) arr.splice(0, arr.length - this.latWin);
  }

  _percentiles(arr) {
    if (!arr.length) return { n: 0, p50: null, p90: null, p99: null, min: null, max: null, mean: null };
    const a = arr.slice().sort((x, y) => x - y);
    const q = (p) => {
      const i = Math.max(0, Math.min(a.length - 1, Math.floor((p / 100) * (a.length - 1))));
      return a[i];
    };
    const sum = a.reduce((s, x) => s + x, 0);
    return { n: a.length, min: a[0], max: a[a.length - 1], mean: sum / a.length, p50: q(50), p90: q(90), p99: q(99) };
  }

  _onBar() {
    const now = Date.now();

    if (this.running) {
      const health = this.getBinanceHealth();
      if (health.wsUp && health.mappedSymbolsCount === 0 && this.lastBnWsOpenTs && (now - this.lastBnWsOpenTs) > 12000) {
        if ((now - this._bnDegradeLastLogTs) > 5000) {
          this._bnDegradeLastLogTs = now;
          this.logger?.log("bn_ws_degraded", { reason: "mappedSymbolsCount=0_after_open", health });
        }
        if (!this._bnFallbackAttempted && this._binanceWsMode === "bookTickerAll") {
          this._bnFallbackAttempted = true;
          this._binanceWsMode = "streamWhitelist";
          this.logger?.log("bn_ws_fallback", { from: "!bookTicker", to: "streamWhitelist", symbolsCount: this.symbols.length });
          this._cleanupBinanceWs();
          this._connectBinanceWs();
        }
      }
      if (health.lastMsgAgeMs != null && health.lastMsgAgeMs > 10000 && (now - this._bnDegradeLastLogTs) > 5000) {
        this._bnDegradeLastLogTs = now;
        this.logger?.log("bn_ws_degraded", { reason: "lastMsgAgeMs_threshold", health });
      }
      this.broadcast("feedStatus", { ts: now, bybit: { wsUp: this.isWsUp(), lastMsgAgeMs: this.lastWsMsgRecvTs ? (now - this.lastWsMsgRecvTs) : null, reconnects: this.reconnects }, binance: health });
    }

    for (const s of this.symbols) {
      for (const source of ["BT", "BNB"]) {
      const st = this.state.get(this._seriesKey(s, source));
      const rb = this.bars.get(this._seriesKey(s, source));
      if (!st || !rb) continue;

      const mid = st.mid;
      if (!Number.isFinite(mid) || mid <= 0) continue;

      const prev = st.prevBarMid;
      const r = (prev && prev > 0) ? Math.log(mid / prev) : 0;

      const bar = { ts: now, t: now, symbol: s, source, mid, r };
      rb.push(bar);
      st.prevBarMid = mid;

      if (st.lastTickRecvTs != null) {
        const barLatencyMs = now - st.lastTickRecvTs;
        this._pushRoll(this._barLatency, barLatencyMs);
        if (st.lastTickExchTs != null) {
          const wsDelayMs = st.lastTickRecvTs - st.lastTickExchTs;
          this._pushRoll(this._wsDelay, wsDelayMs);
        }
      }

      this.broadcast("bar", bar);
      this.logger?.log("bar", { symbol: s, source, t: now, mid, r });
      }
    }
  }

  _trimWindow(map, cutoffMs) {
    for (const [k, arr] of map.entries()) {
      while (arr.length && arr[0].ts < cutoffMs) arr.shift();
      if (!arr.length) map.delete(k);
    }
  }

  _applyPublicTrade(topic, d) {
    const symbol = d?.s || topic.split(".")[1];
    if (!symbol) return;
    const ts = Number(d?.T || d?.ts || Date.now());
    const side = String(d?.S || d?.side || "");
    const size = Number(d?.v || d?.size || d?.q);
    const price = Number(d?.p || d?.price);
    if (!Number.isFinite(size) || size <= 0) return;
    const item = { ts: Number.isFinite(ts) ? ts : Date.now(), side, size, price: Number.isFinite(price) ? price : null };
    const arr = this.trades.get(symbol) || [];
    arr.push(item);
    this.trades.set(symbol, arr);
    this._trimWindow(this.trades, Date.now() - (60 * 60 * 1000));
  }

  _applyLiquidation(topic, d) {
    const symbol = d?.symbol || topic.split(".")[1];
    if (!symbol) return;
    const ts = Number(d?.T || d?.ts || Date.now());
    const side = String(d?.S || d?.side || "");
    const size = Number(d?.v || d?.size || 0);
    const price = Number(d?.p || d?.price || 0);
    if (!Number.isFinite(size) || size <= 0) return;
    const arr = this.liquidations.get(symbol) || [];
    arr.push({ ts: Number.isFinite(ts) ? ts : Date.now(), side, size, price: Number.isFinite(price) ? price : null });
    this.liquidations.set(symbol, arr);
    this._trimWindow(this.liquidations, Date.now() - (60 * 60 * 1000));
  }

  getTickerSnapshot(symbol) {
    return this.tickersSnapshot.get(String(symbol || "").toUpperCase()) || null;
  }

  getTrades(symbol, windowMs = 5 * 60 * 1000) {
    const sym = String(symbol || "").toUpperCase();
    const arr = this.trades.get(sym) || [];
    const cut = Date.now() - windowMs;
    return arr.filter((x) => x.ts >= cut);
  }

  getLiquidations(symbol, windowMs = 15 * 60 * 1000) {
    const sym = String(symbol || "").toUpperCase();
    const arr = this.liquidations.get(sym) || [];
    const cut = Date.now() - windowMs;
    return arr.filter((x) => x.ts >= cut);
  }
}
