import WebSocket from "ws";
import { makeWsAuthArgs, nowMs } from "./bybitAuth.js";
import { resolveBybitConfig } from "./bybitEnv.js";

/**
 * TradeWsClient (V5)
 * Endpoint: wss://stream.bybit.com/v5/trade
 * Used for order.create / order.amend / order.cancel.
 */
export class TradeWsClient {
  constructor({ url, apiKey, apiSecret, logger = null } = {}) {
    const cfg = resolveBybitConfig();
    this.url = url || process.env.BYBIT_TRADE_WS_URL || cfg.wsTradeUrl;
    this._disabled = cfg.tradeTransport !== "ws";
    this.apiKey = apiKey || process.env.BYBIT_API_KEY || "";
    this.apiSecret = apiSecret || process.env.BYBIT_API_SECRET || "";
    this.logger = logger;

    this.ws = null;
    this.running = false;
    this.isAuthed = false;

    this.lastMsgTs = null;
    this.reconnects = 0;
    this._reconnectTimer = null;
    this._reconnectDelayMs = 500;

    this._pingTimer = null;
    this._pending = new Map(); // reqId -> {resolve,reject,timer}
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
      pending: this._pending.size,
    };
  }

  start() {
    if (this._disabled) {
      this.logger?.log("trade_ws_disabled", { reason: "trade_transport_not_ws", url: this.url });
      return;
    }

    if (this.running) return;
    this.running = true;
    this._connect();
  }

  stop() {
    this.running = false;
    this._cleanup(true, "stopped");
  }

  async waitReady(timeoutMs = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isAuthed) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  async orderCreate(params, { timeoutMs = 5000, reqId = null } = {}) {
    if (!this.running) throw new Error("trade ws not running");
    const ok = await this.waitReady(5000);
    if (!ok) throw new Error("trade ws not ready/auth");

    const id = reqId || `ord-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const header = {
      "X-BAPI-TIMESTAMP": String(nowMs()),
      "X-BAPI-RECV-WINDOW": String(Number(process.env.BYBIT_RECV_WINDOW || 5000)),
      "Referer": String(process.env.BYBIT_BROKER_REFERER || "bot-mvp"),
    };

    const msg = { reqId: id, header, op: "order.create", args: [params] };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error("order.create timeout"));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timer });

      try {
        this.ws.send(JSON.stringify(msg));
        this.logger?.log("trade_ws_send", { op: "order.create", reqId: id, symbol: params?.symbol, side: params?.side, orderType: params?.orderType });
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(new Error(e?.message || "send failed"));
      }
    });
  }

  _connect() {
    if (!this.running) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.isAuthed = false;
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      this.logger?.log("trade_ws_state", { state: "open", url: this.url });

      const expires = nowMs() + 10_000;
      const args = makeWsAuthArgs(this.apiKey, this.apiSecret, expires);
      this.ws.send(JSON.stringify({ op: "auth", args }));

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

      if (msg?.op === "auth") {
        this.isAuthed = (msg?.retCode === 0);
        this.logger?.log("trade_ws_auth", { ok: this.isAuthed, retCode: msg?.retCode, retMsg: msg?.retMsg });
        return;
      }

      // acks for order.create/amend/cancel include reqId
      const reqId = msg?.reqId;
      if (typeof reqId === "string") {
        const p = this._pending.get(reqId);
        if (p) {
          clearTimeout(p.timer);
          this._pending.delete(reqId);
          if (msg?.retCode === 0) p.resolve(msg);
          else p.reject(new Error(msg?.retMsg || `retCode=${msg?.retCode}`));
        }
      }
    });

    const onDown = (why) => {
      this.logger?.log("trade_ws_state", { state: "down", why: String(why || "") });
      this._cleanup(false, "down");
      if (!this.running) return;
      this.reconnects++;
      this._scheduleReconnect();
    };

    this.ws.on("close", () => onDown("close"));
    this.ws.on("error", (e) => onDown(e?.message || "error"));
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

  _cleanup(clearPending, reason) {
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

    this.isAuthed = false;

    if (clearPending) {
      for (const [id, p] of this._pending.entries()) {
        clearTimeout(p.timer);
        p.reject(new Error(`pending cancelled: ${reason || "cleanup"}`));
        this._pending.delete(id);
      }
    }
  }
}
