// TradeState: in-memory store for private stream + REST snapshots.
// Keeps a reconciled view of orders/executions/positions/wallet.
// NOTE: This is an MVP store (no persistence). Use JSONL logs for audit/replay.

function keyPos(symbol, positionIdx) {
  return `${symbol || ""}:${Number(positionIdx) || 0}`;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export class TradeState {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.reset();
  }

  reset() {
    this.wallet = null; // raw wallet payload (latest)
    this.orders = new Map(); // orderId -> order obj
    this.positions = new Map(); // symbol:positionIdx -> position obj
    this.executions = []; // newest-first; bounded
    this.updatedAt = { wallet: null, order: null, execution: null, position: null, reconcile: null };
  }

  applyPrivate(topic, msg) {
    const t = String(topic || "");
    const data = Array.isArray(msg?.data) ? msg.data : (msg?.data ? [msg.data] : []);
    if (!data.length) return false;

    let changed = false;

    if (t.includes("wallet")) {
      // wallet can be snapshot/delta; keep last message (it contains full coin arrays often)
      this.wallet = msg;
      this.updatedAt.wallet = Date.now();
      changed = true;
      return changed;
    }

    if (t.includes("order")) {
      for (const o of data) {
        const id = o?.orderId || o?.order_id || o?.id;
        if (!id) continue;
        this.orders.set(String(id), o);
        changed = true;
      }
      this.updatedAt.order = Date.now();
      return changed;
    }

    if (t.includes("execution")) {
      for (const ex of data) {
        const execId = ex?.execId || ex?.exec_id;
        // Keep raw, but add a stable id if missing
        const item = execId ? ex : { ...ex, _localId: `${Date.now()}-${Math.random()}` };
        this.executions.unshift(item);
        changed = true;
      }
      // bound list
      if (this.executions.length > 200) this.executions.length = 200;
      this.updatedAt.execution = Date.now();
      return changed;
    }

    if (t.includes("position")) {
      for (const p of data) {
        const sym = p?.symbol;
        if (!sym) continue;
        const idx = (p?.positionIdx ?? p?.position_idx ?? 0);
        const k = keyPos(sym, idx);
        this.positions.set(k, p);
        changed = true;
      }
      this.updatedAt.position = Date.now();
      return changed;
    }

    return false;
  }

  // REST reconcile snapshot (best-effort). Safe to call when key/secret exist.
  async reconcile(rest, opts = {}) {
    const { positions = true, orders = true, wallet = true } = opts || {};
    const t0 = Date.now();
    const out = { ok: true, errors: [] };

    if (positions) {
    try {
      const rPos = await rest.get("/v5/position/list", { category: "linear" });
      const list = rPos?.result?.list || rPos?.result?.data?.list || [];
      if (Array.isArray(list)) {
        for (const p of list) {
          const sym = p?.symbol;
          if (!sym) continue;
          const idx = (p?.positionIdx ?? 0);
          this.positions.set(keyPos(sym, idx), p);
        }
        this.updatedAt.position = Date.now();
      }
      this.logger?.log("reconcile_positions", { retCode: rPos?.retCode, n: Array.isArray(list) ? list.length : 0 });
    } catch (e) {
      out.ok = false;
      out.errors.push({ scope: "positions", error: e?.message || "positions error" });
      this.logger?.log("reconcile_fail", { scope: "positions", error: e?.message || "positions error" });
    }
    }

    if (orders) {
    try {
      const rOrd = await rest.get("/v5/order/realtime", { category: "linear" });
      const list = rOrd?.result?.list || rOrd?.result?.data?.list || [];
      if (Array.isArray(list)) {
        // only open orders should be returned, but keep as latest view
        for (const o of list) {
          const id = o?.orderId || o?.order_id || o?.id;
          if (!id) continue;
          this.orders.set(String(id), o);
        }
        this.updatedAt.order = Date.now();
      }
      this.logger?.log("reconcile_orders", { retCode: rOrd?.retCode, n: Array.isArray(list) ? list.length : 0 });
    } catch (e) {
      out.ok = false;
      out.errors.push({ scope: "orders", error: e?.message || "orders error" });
      this.logger?.log("reconcile_fail", { scope: "orders", error: e?.message || "orders error" });
    }
    }

    if (wallet) {
    try {
      // UTA unified is common. If it fails, user can still rely on WS wallet events.
      const rWal = await rest.get("/v5/account/wallet-balance", { accountType: "UNIFIED" });
      this.wallet = rWal;
      this.updatedAt.wallet = Date.now();
      this.logger?.log("reconcile_wallet", { retCode: rWal?.retCode });
    } catch (e) {
      out.ok = false;
      out.errors.push({ scope: "wallet", error: e?.message || "wallet error" });
      this.logger?.log("reconcile_fail", { scope: "wallet", error: e?.message || "wallet error" });
    }
    }

    this.updatedAt.reconcile = Date.now();
    this.logger?.log("reconcile_done", { ok: out.ok, ms: Date.now() - t0, errors: out.errors.length });
    return out;
  }

  getPositions() {
    return Array.from(this.positions.values());
  }

  getOrders() {
    return Array.from(this.orders.values());
  }

  getExecutions() {
    return Array.isArray(this.executions) ? this.executions.slice() : [];
  }



_isTerminalOrderStatus(st) {
  const s = String(st || "");
  return ["Filled","Cancelled","Rejected","Deactivated"].includes(s);
}

getOpenOrders() {
  const out = [];
  for (const o of this.orders.values()) {
    const st = o?.orderStatus || o?.order_status || o?.status;
    if (this._isTerminalOrderStatus(st)) continue;
    out.push(o);
  }
  return out;
}


  summary() {
    return {
      orders: this.orders.size,
      positions: this.positions.size,
      executions: this.executions.length,
      updatedAt: { ...this.updatedAt },
    };
  }

  snapshot({ maxOrders = 50, maxExecutions = 30 } = {}) {
    const ordersArr = Array.from(this.orders.values());
    // sort orders by updatedTime/createdTime desc (best-effort)
    ordersArr.sort((a, b) => {
      const ta = safeNum(a?.updatedTime || a?.updated_time || a?.createdTime || a?.created_time) || 0;
      const tb = safeNum(b?.updatedTime || b?.updated_time || b?.createdTime || b?.created_time) || 0;
      return tb - ta;
    });

    const posArr = Array.from(this.positions.values());

    return {
  ts: Date.now(),
  summary: this.summary(),
  wallet: this.wallet,
  positions: posArr,
  openOrders: this.getOpenOrders().slice(0, Math.max(0, Number(maxOrders) || 50)),
  // full orders map (may include filled/cancelled from WS); kept for debugging/back-compat
  orders: ordersArr.slice(0, Math.max(0, Number(maxOrders) || 50)),
  executions: this.executions.slice(0, Math.max(0, Number(maxExecutions) || 30)),
};

  }
}
