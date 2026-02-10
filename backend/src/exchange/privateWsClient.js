import WebSocket from "ws";
import { makeWsAuthArgs, nowMs } from "./bybitAuth.js";
import { resolveBybitConfig } from "./bybitEnv.js";

/**
 * PrivateWsClient (V5)
 * Endpoint: wss://stream.bybit.com/v5/private
 * Topics: order, execution, position, wallet (all-in-one)
 */
function maskKey(k) {
  if (!k) return "";
  const s = String(k);
  if (s.length <= 6) return s;
  return s.slice(0, 3) + "…" + s.slice(-3);
}

export class PrivateWsClient {
  constructor({ url, apiKey, apiSecret, logger = null, onEvent = null } = {}) {
    const cfg = resolveBybitConfig();
    this.url = url || process.env.BYBIT_PRIVATE_WS_URL || cfg.wsPrivateUrl;
    this.apiKey = apiKey || process.env.BYBIT_API_KEY || "";
    this.apiSecret = apiSecret || process.env.BYBIT_API_SECRET || "";

    this.logger = logger;
    this.onEvent = onEvent; // (topic,payload)=>void

    this.ws = null;
    this.isAuthed = false;
    this.running = false;

    this.lastMsgTs = null;
    this.reconnects = 0;
    this._reconnectTimer = null;
    this._reconnectDelayMs = 500;

    this._pingTimer = null;
    this._subs = new Set(); // desired topics
  }

  setDesiredTopics(topics) {
    this._subs = new Set((topics || []).filter(Boolean));
    this._syncSubscribe();
  }

  getStats() {
    const now = Date.now();
    return {
      url: this.url,
      running: this.running,
      connected: !!(this.ws && this.ws.readyState === WebSocket.OPEN),
      authed: this.isAuthed,
      lastMsgAgeMs: this.lastMsgTs ? (now - this.lastMsgTs) : null,
      reconnects: this.reconnects,
      topics: Array.from(this._subs),
    };
  }

  start() {
    if (this.running) return;
    this.logger?.log("priv_ws_start", { url: this.url, apiKey: maskKey(this.apiKey), hasSecret: !!this.apiSecret });
    this.running = true;
    this._connect();
  }

  stop() {
    this.running = false;
    this._cleanup(true);
  }

  _connect() {
    if (!this.running) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.isAuthed = false;
    this.logger?.log("priv_ws_connect", { url: this.url, apiKey: maskKey(this.apiKey), hasSecret: !!this.apiSecret });
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      this.logger?.log("priv_ws_open", { url: this.url });

      // auth
      const expires = nowMs() + 10_000;
      const args = makeWsAuthArgs(this.apiKey, this.apiSecret, expires);
      this.logger?.log("priv_ws_auth_send", { url: this.url, apiKey: maskKey(this.apiKey), expires, signLen: String(args?.[2] || "").length });
      this.ws.send(JSON.stringify({ op: "auth", args }));

      // ping
      this._pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          try { this.ws.send(JSON.stringify({ op: "ping" })); } catch {}
        }
      }, 20_000);
      this._pingTimer.unref?.();
    });

    this.ws.on("message", (raw) => {
      this.lastMsgTs = Date.now();
      let msg;
      try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }

      // auth response
      if (msg?.op === "auth") {
        // Bybit may respond with {success:true, ret_msg:""} instead of retCode.
        try {
          const safe = { ...msg };
          if (Array.isArray(safe?.args)) safe.args = `[args:${safe.args.length}]`;
          this.logger?.log("priv_ws_auth_msg", safe);
        } catch {}

        this.isAuthed = (msg?.retCode === 0) || (msg?.success === true);
        this.logger?.log("priv_ws_auth", { ok: this.isAuthed, retCode: msg?.retCode, retMsg: msg?.retMsg, success: msg?.success, ret_msg: msg?.ret_msg });
        if (this.isAuthed) this._syncSubscribe(true);
        return;
      }

      // subscribe response
      if (msg?.op === "subscribe") {
        this.logger?.log("priv_ws_sub_ack", { success: msg?.success, retCode: msg?.retCode, retMsg: msg?.retMsg, ret_msg: msg?.ret_msg, args: msg?.args });
        return;
      }

      // unexpected errors
      if ((msg?.success === false) || (msg?.retCode && msg.retCode !== 0)) {
        this.logger?.log("priv_ws_unexpected_msg", { op: msg?.op, topic: msg?.topic, success: msg?.success, retCode: msg?.retCode, retMsg: msg?.retMsg, ret_msg: msg?.ret_msg });
      }


      // data messages have "topic"
      const topic = msg?.topic;
      if (typeof topic === "string" && msg?.data) {
        this.onEvent?.(topic, msg);
      }
    });

    const onDown = (why) => {
      this.logger?.log("priv_ws_down", { url: this.url, why });
      this._cleanup(false);
      if (!this.running) return;
      this.reconnects++;
      this._scheduleReconnect();
    };

    this.ws.on("close", (code, reason) => onDown({ type: "close", code, reason: reason?.toString?.() || String(reason || "") }));
    this.ws.on("error", (e) => onDown({ type: "error", message: e?.message || "error", name: e?.name }));
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(15_000, this._reconnectDelayMs);
    this._reconnectDelayMs = Math.min(15_000, this._reconnectDelayMs * 2);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
    this._reconnectTimer.unref?.();
  }

  _cleanup(clearSubs) {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (clearSubs) this._subs.clear();
  }

  _syncSubscribe(force = false) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!this.isAuthed) return;
    if (!this._subs.size) return;

    // for private streams, subscribe args are topics as strings
    // NOTE: all-in-one topics: order/execution/position/wallet
    const args = Array.from(this._subs);

    if (!force) {
      // still safe to (re)subscribe; bybit handles duplicates, but keep it minimal
    }

    try {
      ws.send(JSON.stringify({ op: "subscribe", args }));
      this.logger?.log("priv_ws_sub", { args });
    } catch {}
  }
}
