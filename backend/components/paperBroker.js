/**
 * PaperBroker (Step 9)
 * --------------------
 * Minimal paper trading ledger:
 * - Single position at a time (MVP constraint)
 * - Entries at current mid, exits by TP/SL/time
 * - Fees in bps (both entry & exit)
 *
 * Position model:
 *   { symbol, side: "Buy"|"Sell", entryMid, qtyUSDT, qtyCoin, entryTs, holdBars, maxHoldBars, tpR, slR, meta }
 *
 * r here is log-return: r = ln(mid/entryMid)
 * For long: exit if r >= tpR OR r <= -slR
 * For short: exit if r <= -tpR OR r >= slR
 */

function mean(arr) {
  if (!arr?.length) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

function std(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  let s2 = 0;
  for (const x of arr) {
    const d = x - m;
    s2 += d * d;
  }
  return Math.sqrt(s2 / (arr.length - 1));
}

export class PaperBroker {
  constructor({ startingBalanceUSDT = 1000, feeBps = 6, logger = null } = {}) {
    this.logger = logger;
    this.feeBps = Number(process.env.PAPER_FEE_BPS || feeBps);
    this.slippageBps = Number(process.env.PAPER_SLIPPAGE_BPS || 2);
    this.startingBalanceUSDT = Number(process.env.PAPER_START_BAL || startingBalanceUSDT);
    this.reset();
  }

  _applySlippage(mid, side, isEntry) {
    const bps = Number(this.slippageBps || 0);
    if (!Number.isFinite(mid) || mid <= 0 || bps <= 0) return mid;
    const m = mid * (bps / 10000);
    // For Buy: pay up on entry and on exit; for Sell: receive less on entry and on exit.
    const s = String(side);
    const sign = (s === "Buy") ? 1 : -1;
    return mid + sign * m;
  }

  reset() {
    this.cashUSDT = this.startingBalanceUSDT;
    this.equityUSDT = this.startingBalanceUSDT;
    this.position = null;
    this.trades = []; // newest first
    this.stats = { wins: 0, losses: 0, trades: 0, pnlUSDT: 0 };
    this.lastUpdateTs = null;
    this.logger?.log("paper_reset", { cashUSDT: this.cashUSDT, feeBps: this.feeBps });
  }

  getState() {
    return {
      cashUSDT: this.cashUSDT,
      equityUSDT: this.equityUSDT,
      position: this.position,
      trades: this.trades.slice(0, 30),
      stats: this.stats,
      lastUpdateTs: this.lastUpdateTs,
      feeBps: this.feeBps,
      startingBalanceUSDT: this.startingBalanceUSDT,
    };
  }

  _fee(notionalUSDT) {
    return (Number(notionalUSDT) || 0) * (this.feeBps / 10_000);
  }

  open({ symbol, side, entryMid, qtyUSDT, tpR, slR, maxHoldBars = 20, meta = {} }) {
    if (this.position) throw new Error("paper: position already open");
    if (!symbol) throw new Error("paper: symbol required");
    if (side !== "Buy" && side !== "Sell") throw new Error("paper: side must be Buy|Sell");

    const mid = Number(entryMid);
    if (!Number.isFinite(mid) || mid <= 0) throw new Error("paper: entryMid invalid");

    const notional = Number(qtyUSDT);
    if (!Number.isFinite(notional) || notional <= 0) throw new Error("paper: qtyUSDT must be > 0");
    if (notional > this.cashUSDT) throw new Error("paper: insufficient cash");

    const qtyCoin = notional / mid;
    const feeIn = this._fee(notional);

    this.cashUSDT -= (notional + feeIn);

    this.position = {
      symbol,
      side,
      entryMid: mid,
      qtyUSDT: notional,
      qtyCoin,
      entryTs: Date.now(),
      holdBars: 0,
      maxHoldBars: Math.max(1, Number(maxHoldBars) || 1),
      tpR: Math.max(0, Number(tpR) || 0),
      slR: Math.max(0, Number(slR) || 0),
      meta,
    };

    this.logger?.log("paper_open", { symbol, side, entryMid: mid, qtyUSDT: notional, tpR: this.position.tpR, slR: this.position.slR, maxHoldBars: this.position.maxHoldBars, feeIn });
    return this.position;
  }

  update(symbol, mid, { reason = "tick" } = {}) {
    this.lastUpdateTs = Date.now();
    const m = Number(mid);
    if (!Number.isFinite(m) || m <= 0) return null;

    if (!this.position) {
      this.equityUSDT = this.cashUSDT;
      return null;
    }

    if (this.position.symbol !== symbol) {
      // mark-to-market only if we have price
      this._markEquity(m);
      return null;
    }

    // mark equity with unrealized
    this._markEquity(m);

    const pos = this.position;
    const r = Math.log(m / pos.entryMid);

    // time exit check uses holdBars, advanced externally (onBar for follower)
    const shouldExitByTime = pos.holdBars >= pos.maxHoldBars;

    let shouldExit = false;
    let exitReason = null;

    if (pos.side === "Buy") {
      if (pos.tpR > 0 && r >= pos.tpR) { shouldExit = true; exitReason = "tp"; }
      else if (pos.slR > 0 && r <= -pos.slR) { shouldExit = true; exitReason = "sl"; }
    } else {
      if (pos.tpR > 0 && r <= -pos.tpR) { shouldExit = true; exitReason = "tp"; }
      else if (pos.slR > 0 && r >= pos.slR) { shouldExit = true; exitReason = "sl"; }
    }

    if (!shouldExit && shouldExitByTime) { shouldExit = true; exitReason = "time"; }

    if (shouldExit) return this.close(m, exitReason);

    return null;
  }

  advanceHold(symbol) {
    if (!this.position) return;
    if (this.position.symbol !== symbol) return;
    this.position.holdBars += 1;
  }

  _markEquity(mid) {
    if (!this.position) {
      this.equityUSDT = this.cashUSDT;
      return;
    }
    const pos = this.position;
    const m = Number(mid);
    if (!Number.isFinite(m) || m <= 0) return;

    const pnl = pos.side === "Buy"
      ? (m - pos.entryMid) * pos.qtyCoin
      : (pos.entryMid - m) * pos.qtyCoin;

    this.equityUSDT = this.cashUSDT + pos.qtyUSDT + pnl;
  }

  close(exitMid, reason = "manual") {
    if (!this.position) return null;

    const pos = this.position;
    const m = Number(exitMid);
    if (!Number.isFinite(m) || m <= 0) throw new Error("paper: exitMid invalid");

    const pnl = pos.side === "Buy"
      ? (m - pos.entryMid) * pos.qtyCoin
      : (pos.entryMid - m) * pos.qtyCoin;

    const feeOut = this._fee(pos.qtyUSDT);

    const settlement = pos.qtyUSDT + pnl - feeOut;
    this.cashUSDT += settlement;

    const trade = {
      ts: Date.now(),
      symbol: pos.symbol,
      side: pos.side,
      entryMid: pos.entryMid,
      exitMid: m,
      qtyUSDT: pos.qtyUSDT,
      pnlUSDT: pnl - (this._fee(pos.qtyUSDT) + feeOut),
      reason,
      holdBars: pos.holdBars,
      tpR: pos.tpR,
      slR: pos.slR,
      meta: pos.meta,
    };

    this.trades.unshift(trade);
    if (this.trades.length > 200) this.trades.length = 200;

    this.stats.trades += 1;
    this.stats.pnlUSDT += trade.pnlUSDT;
    if (trade.pnlUSDT >= 0) this.stats.wins += 1;
    else this.stats.losses += 1;

    this.position = null;
    this.equityUSDT = this.cashUSDT;

    this.logger?.log("paper_close", trade);
    return trade;
  }

  static rollingStd(returns) {
    return std(returns || []);
  }
}
