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

    // Public REST (no auth) used as a sanity reference for prices (helps detect rare WS scale glitches)
    this.publicHttpBaseUrl = process.env.BYBIT_PUBLIC_HTTP_URL || "https://api.bybit.com";
    this._restRef = new Map(); // symbol -> { ts, last, mark, index }
    this._restTimer = null;

    this.symbols = [];
    this.running = false;

    this.state = new Map(); // symbol -> { mid, prevBarMid, lastTickRecvTs, lastTickExchTs, lastTickLoggedTs }
    this.bars = new Map();  // symbol -> RingBuffer

    this._barTimer = null;

    this._ws = null;
    this._wsPingTimer = null;
    this._reconnectTimer = null;
    this._reconnectDelayMs = 500;
    this._subscribedTopics = new Set();

    this.reconnects = 0;
    this.lastWsMsgRecvTs = null;
    this.lastWsOpenTs = null;
    this.lastWsCloseTs = null;

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

  getStats() {
    const now = Date.now();
    return {
      mode: this.mode,
      wsUp: this.isWsUp(),
      wsUrl: this.wsUrl,
      reconnects: this.reconnects,
      lastWsMsgAgeMs: this.lastWsMsgRecvTs ? (now - this.lastWsMsgRecvTs) : null,
      barLatency: this._percentiles(this._barLatency),
      wsDelay: this._percentiles(this._wsDelay),
    };
  }

  setSymbols(symbols) {
    const uniq = [...new Set(symbols || [])].slice(0, 300);
    this.symbols = uniq;

    for (const s of uniq) {
      if (!this.state.has(s)) this.state.set(s, { mid: null, prevBarMid: null, lastTickRecvTs: null, lastTickExchTs: null, lastTickLoggedTs: 0 });
      if (!this.bars.has(s)) this.bars.set(s, new RingBuffer(this.maxBars));
    }
    for (const s of [...this.state.keys()]) if (!uniq.includes(s)) this.state.delete(s);
    for (const s of [...this.bars.keys()]) if (!uniq.includes(s)) this.bars.delete(s);

    this._syncSubscriptions();
    this.logger?.log("symbols", { symbols: this.symbols });
  }

  start({ ws = true } = {}) {
    if (this.running) return;
    this.running = true;
    this.mode = ws ? "ws" : "replay";

    if (ws) this._connectWs();
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
    this.logger?.log("feed_stop", {});
  }

  getBars(symbol, n) {
    const rb = this.bars.get(symbol);
    if (!rb) return [];
    return rb.tail(n);
  }

  getMid(symbol) {
    const st = this.state.get(symbol);
    let mid = st?.mid;

    // REST reference (best-effort) to correct scale issues even when mark/index are missing
    const rr = this._restRef.get(symbol);
    const restRef = rr?.last || rr?.mark || rr?.index || null;

    if (restRef && typeof mid === "number" && Number.isFinite(mid)) {
      mid = this._normalizeScale(mid, restRef);
    }

    return (typeof mid === "number" && Number.isFinite(mid)) ? mid : null;
  }

  getReturns(symbol, n) {
    const bars = this.getBars(symbol, n);
    const rs = [];
    for (const b of bars) {
      const v = Number(b?.r);
      if (Number.isFinite(v)) rs.push(v);
    }
    return rs;
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

    const st = this.state.get(s);
    if (!st) return;

    st.mid = m;
    st.lastTickRecvTs = recvTs;
    st.lastTickExchTs = (exchTs != null && Number.isFinite(Number(exchTs))) ? Number(exchTs) : null;

    // do not try to normalize scale here (replay file already stored mids). getMid() will still apply restRef scaling if enabled.
    this.broadcast("price", { ts: recvTs, t: recvTs, symbol: s, mid: m, exchTs: st.lastTickExchTs, source });

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
      if (typeof topic !== "string" || !topic.startsWith("tickers.")) return;

      const exchTs = Number(msg.ts ?? NaN);
      const data = msg.data;
      if (Array.isArray(data)) {
        for (const d of data) this._applyTicker(topic, d, exchTs);
      } else if (data) {
        this._applyTicker(topic, data, exchTs);
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

  _applyTicker(topic, d, exchTs) {
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

    const st = this.state.get(symbol);
    if (!st) return;

    const recvTs = Date.now();
    st.mid = mid;
    st.lastTickRecvTs = recvTs;
    st.lastTickExchTs = Number.isFinite(exchTs) ? exchTs : null;

    this.broadcast("price", { ts: recvTs, t: recvTs, symbol, mid, exchTs });

    if (this.logger) {
      if ((recvTs - (st.lastTickLoggedTs || 0)) >= this.tickLogSampleMs) {
        st.lastTickLoggedTs = recvTs;
        const wsDelayMs = (st.lastTickExchTs != null) ? (recvTs - st.lastTickExchTs) : null;
        this.logger.log("tick_sample", { symbol, mid, recvTs, exchTs: st.lastTickExchTs, wsDelayMs });
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

  _syncSubscriptions(full = false) {
    const ws = this._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const desired = new Set(this.symbols.map((s) => `tickers.${s}`));
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

    for (const s of this.symbols) {
      const st = this.state.get(s);
      const rb = this.bars.get(s);
      if (!st || !rb) continue;

      const mid = st.mid;
      if (!Number.isFinite(mid) || mid <= 0) continue;

      const prev = st.prevBarMid;
      const r = (prev && prev > 0) ? Math.log(mid / prev) : 0;

      const bar = { ts: now, t: now, symbol: s, mid, r };
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
      this.logger?.log("bar", { symbol: s, t: now, mid, r });
    }
  }
}
