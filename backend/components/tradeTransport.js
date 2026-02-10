import { resolveBybitConfig } from "./bybitEnv.js";
import { TradeWsClient } from "./tradeWsClient.js";

function safeStr(x) {
  try { return String(x ?? ""); } catch { return ""; }
}

export class TradeTransport {
  constructor({ rest, tradeState, hub, logger } = {}) {
    this.cfg = resolveBybitConfig();

    // Force transport if needed (MVP stability). Values: "rest" | "ws"
    const forced = safeStr(process.env.BYBIT_TRADE_TRANSPORT).toLowerCase().trim();
    this.mode = (forced === "rest" || forced === "ws") ? forced : this.cfg.tradeTransport;

    this.rest = rest;
    this.tradeState = tradeState;
    this.hub = hub;
    this.logger = logger;

    // WS client (kept for future mainnet/testnet rollout)
    this.ws = new TradeWsClient({ url: this.cfg.wsTradeUrl, logger });

    // REST poller state
    this.running = false;
    this.isAuthed = false;
    this.lastMsgTs = null;
    this.reconnects = 0;

    this._pollTimer = null;
    this._pollMs = Math.max(500, Number(process.env.TRADE_REST_POLL_MS || 2000));
    this._busy = false;

    this._seenExecIds = new Set();
  }

  getStats() {
    if (this.mode === "ws") {
      const s = this.ws.getStats();
      return { ...s, note: "ws" };
    }
    const now = Date.now();
    return {
      url: this.cfg.httpBaseUrl,
      running: this.running,
      connected: this.running,
      authed: this.isAuthed,
      lastMsgAgeMs: this.lastMsgTs ? (now - this.lastMsgTs) : null,
      reconnects: this.reconnects,
      pending: 0,
      note: "rest_poll",
      pollMs: this._pollMs,
    };
  }

  start() {
    if (this.mode === "ws") {
      this.ws.start();
      return;
    }
    if (this.running) return;
    this.running = true;

    const hasKey = !!process.env.BYBIT_API_KEY;
    const hasSecret = !!process.env.BYBIT_API_SECRET;
    this.isAuthed = hasKey && hasSecret;

    this.logger?.log("trade_rest_start", {
      pollMs: this._pollMs,
      hasKey,
      hasSecret,
      http: this.cfg.httpBaseUrl,
    });

    // Immediate tick then periodic
    this._tick().catch(() => {});
    this._pollTimer = setInterval(() => {
      this._tick().catch(() => {});
    }, this._pollMs);
    this._pollTimer.unref?.();
  }

  stop() {
    if (this.mode === "ws") {
      this.ws.stop();
      return;
    }
    this.running = false;
    this.isAuthed = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this.logger?.log("trade_rest_stop", {});
  }

  async _tick() {
    if (!this.running) return;
    if (!this.rest || !this.tradeState || !this.hub) return;
    if (this._busy) return;

    if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) {
      this.isAuthed = false;
      return;
    }

    this._busy = true;
    try {
      this.isAuthed = true;

      // Snapshot: positions / open orders / wallet
      const snap = await this.tradeState.reconcile(this.rest, { positions: true, orders: true, wallet: true });

      // Executions via REST (so demo works without trade WS)
      try {
        const ex = await this.rest.get("/v5/execution/list", { category: "linear", limit: 50 });
        const list = ex?.result?.list || ex?.result?.data?.list || [];
        if (Array.isArray(list) && list.length) {
          for (const item of list) {
            const execId = safeStr(item?.execId || item?.exec_id);
            if (!execId) continue;
            if (this._seenExecIds.has(execId)) continue;
            this._seenExecIds.add(execId);
            this.tradeState.executions.unshift(item);
          }
          if (this.tradeState.executions.length > 200) this.tradeState.executions.length = 200;
          this.tradeState.updatedAt.execution = Date.now();
        }
        this.logger?.log("trade_rest_exec", { retCode: ex?.retCode, n: Array.isArray(list) ? list.length : 0 });
      } catch (e) {
        this.logger?.log("trade_rest_exec_err", { error: e?.message || String(e) });
      }

      this.lastMsgTs = Date.now();

      // Push updated state to UI
      this.hub.broadcast("tradeState", this.tradeState.snapshot({ maxOrders: 50, maxExecutions: 30 }));

      this.logger?.log("trade_rest_tick", { ok: snap?.ok, errors: snap?.errors?.length || 0 });
    } catch (e) {
      this.logger?.log("trade_rest_tick_err", { error: e?.message || String(e) });
    } finally {
      this._busy = false;
    }
  }
}
