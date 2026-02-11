function mean(arr) {
  if (!arr?.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  const s2 = arr.reduce((acc, x) => acc + (x - m) ** 2, 0);
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

  _slippageUSDT(notionalUSDT) {
    return (Number(notionalUSDT) || 0) * (this.slippageBps / 10_000);
  }

  reset() {
    this.cashUSDT = this.startingBalanceUSDT;
    this.equityUSDT = this.startingBalanceUSDT;
    this.position = null;
    this.trades = [];
    this.equityPoints = [{ ts: Date.now(), equityUSDT: this.equityUSDT }];
    this.stats = { wins: 0, losses: 0, trades: 0, pnlUSDT: 0, feesUSDT: 0, slippageUSDT: 0, grossPnlUSDT: 0 };
    this.lastUpdateTs = null;
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
      slippageBps: this.slippageBps,
      startingBalanceUSDT: this.startingBalanceUSDT,
    };
  }

  _fee(notionalUSDT) {
    return (Number(notionalUSDT) || 0) * (this.feeBps / 10_000);
  }

  _pushEquity() {
    const pt = { ts: Date.now(), equityUSDT: this.equityUSDT };
    this.equityPoints.push(pt);
    if (this.equityPoints.length > 10_000) this.equityPoints.shift();
  }

  _realizeCloseChunk(pos, closeMid, closeNotional, reason = "chunk") {
    const notional = Math.max(0, Number(closeNotional) || 0);
    if (notional <= 0 || !Number.isFinite(Number(closeMid)) || Number(closeMid) <= 0) {
      return { grossPnl: 0, feeOut: 0, slipOut: 0, netDelta: 0, qtyCoinClosed: 0, qtyUSDTClosed: 0, reason };
    }
    const qtyCoinClosed = pos.qtyCoin > 0 && pos.qtyUSDT > 0 ? (pos.qtyCoin * (notional / pos.qtyUSDT)) : 0;
    const grossPnl = pos.side === "Buy"
      ? (Number(closeMid) - pos.entryMid) * qtyCoinClosed
      : (pos.entryMid - Number(closeMid)) * qtyCoinClosed;
    const feeOut = this._fee(notional);
    const slipOut = this._slippageUSDT(notional);

    this.stats.feesUSDT += feeOut;
    this.stats.slippageUSDT += slipOut;
    this.cashUSDT += notional + grossPnl - feeOut - slipOut;

    return {
      grossPnl,
      feeOut,
      slipOut,
      netDelta: grossPnl - feeOut - slipOut,
      qtyCoinClosed,
      qtyUSDTClosed: notional,
      reason,
    };
  }

  open({ symbol, side, entryMid, qtyUSDT, tpR, tpR1, tpR2, slR, maxHoldBars = 20, meta = {} }) {
    if (this.position) throw new Error("paper: позиция уже открыта");
    if (!symbol) throw new Error("paper: symbol required");
    if (side !== "Buy" && side !== "Sell") throw new Error("paper: side must be Buy|Sell");

    const mid = Number(entryMid);
    const notional = Number(qtyUSDT);
    if (!Number.isFinite(mid) || mid <= 0) throw new Error("paper: entryMid invalid");
    if (!Number.isFinite(notional) || notional <= 0) throw new Error("paper: qtyUSDT must be > 0");
    if (notional > this.cashUSDT) throw new Error("paper: insufficient cash");

    const qtyCoin = notional / mid;
    const feeIn = this._fee(notional);
    const slipIn = this._slippageUSDT(notional);
    this.stats.feesUSDT += feeIn;
    this.stats.slippageUSDT += slipIn;

    this.cashUSDT -= (notional + feeIn + slipIn);
    this.position = {
      symbol,
      side,
      entryMid: mid,
      qtyUSDT: notional,
      qtyCoin,
      entryTs: Date.now(),
      holdBars: 0,
      maxHoldBars: Math.max(1, Number(maxHoldBars) || 1),
      tpR: Math.max(0, Number(tpR2 ?? tpR) || 0),
      tpR1: Math.max(0, Number(tpR1) || 0),
      tpR2: Math.max(0, Number(tpR2 ?? tpR) || 0),
      slR: Math.max(0, Number(slR) || 0),
      tp1Hit: false,
      tp1Frac: Math.min(0.95, Math.max(0.05, Number(meta?.tp1Frac) || 0.6)),
      stopAtEntry: false,
      entryFeeUSDT: feeIn,
      entrySlippageUSDT: slipIn,
      realizedPnlBeforeFinal: 0,
      realizedFeesUSDT: 0,
      realizedSlippageUSDT: 0,
      meta,
      feesUSDT: feeIn,
      slippageUSDT: slipIn,
    };
    this.logger?.log("paper_position_open", { event: "POSITION_OPEN", symbol, side, qtyUSDT: notional, entryMid: mid, tpR1: this.position.tpR1, tpR2: this.position.tpR2, slR: this.position.slR, maxHoldBars: this.position.maxHoldBars, meta });
    this._markEquity(mid);
    return this.position;
  }

  update(symbol, mid) {
    this.lastUpdateTs = Date.now();
    const m = Number(mid);
    if (!Number.isFinite(m) || m <= 0) return null;

    if (!this.position) {
      this.equityUSDT = this.cashUSDT;
      this._pushEquity();
      return null;
    }

    if (this.position.symbol !== symbol) {
      this._markEquity(m);
      return null;
    }

    this._markEquity(m);
    const pos = this.position;
    const r = Math.log(m / pos.entryMid);
    const shouldExitByTime = pos.holdBars >= pos.maxHoldBars;
    const heldMs = this.lastUpdateTs - pos.entryTs;

    if (!pos.tp1Hit && pos.tpR1 > 0) {
      const tp1Reached = (pos.side === "Buy" && r >= pos.tpR1) || (pos.side === "Sell" && r <= -pos.tpR1);
      if (tp1Reached) {
        const tp1Notional = Math.min(pos.qtyUSDT, Math.max(0, pos.qtyUSDT * pos.tp1Frac));
        const chunk = this._realizeCloseChunk(pos, m, tp1Notional, "tp1");
        pos.qtyUSDT = Math.max(0, pos.qtyUSDT - chunk.qtyUSDTClosed);
        pos.qtyCoin = Math.max(0, pos.qtyCoin - chunk.qtyCoinClosed);
        pos.realizedPnlBeforeFinal += chunk.grossPnl;
        pos.realizedFeesUSDT += chunk.feeOut;
        pos.realizedSlippageUSDT += chunk.slipOut;
        pos.tp1Hit = true;
        pos.stopAtEntry = true;
        this.logger?.log("paper_tp1_hit", {
          event: "TP1_HIT",
          symbol: pos.symbol,
          side: pos.side,
          tp1Frac: pos.tp1Frac,
          exitMid: m,
          qtyUSDTClosed: chunk.qtyUSDTClosed,
          qtyUSDTLeft: pos.qtyUSDT,
          netDeltaUSDT: chunk.netDelta,
          stopAtEntry: pos.stopAtEntry,
        });
        if (pos.qtyUSDT <= 1e-9 || pos.qtyCoin <= 1e-12) return this.close(m, "tp1_full");
      }
    }

    let exitReason = null;
    if (pos.stopAtEntry && heldMs >= 250) {
      if ((pos.side === "Buy" && r <= 0) || (pos.side === "Sell" && r >= 0)) exitReason = "be";
    }
    if (pos.side === "Buy") {
      if (!exitReason && pos.tpR2 > 0 && r >= pos.tpR2) exitReason = "tp2";
      else if (!exitReason && pos.slR > 0 && r <= -pos.slR) exitReason = "sl";
    } else {
      if (!exitReason && pos.tpR2 > 0 && r <= -pos.tpR2) exitReason = "tp2";
      else if (!exitReason && pos.slR > 0 && r >= pos.slR) exitReason = "sl";
    }
    if (!exitReason && shouldExitByTime) exitReason = "time";
    if (exitReason) return this.close(m, exitReason);
    return null;
  }

  advanceHold(symbol) {
    if (this.position && this.position.symbol === symbol) this.position.holdBars += 1;
  }

  _markEquity(mid) {
    if (!this.position) {
      this.equityUSDT = this.cashUSDT;
      this._pushEquity();
      return;
    }
    const pos = this.position;
    const pnl = pos.side === "Buy" ? (mid - pos.entryMid) * pos.qtyCoin : (pos.entryMid - mid) * pos.qtyCoin;
    this.equityUSDT = this.cashUSDT + pos.qtyUSDT + pnl;
    this._pushEquity();
  }

  close(exitMid, reason = "manual") {
    if (!this.position) return null;
    const pos = this.position;
    const m = Number(exitMid);
    if (!Number.isFinite(m) || m <= 0) throw new Error("paper: exitMid invalid");

    const chunk = this._realizeCloseChunk(pos, m, pos.qtyUSDT, reason);
    const grossPnl = Number(pos.realizedPnlBeforeFinal || 0) + chunk.grossPnl;
    const feesTotal = Number(pos.entryFeeUSDT || 0) + Number(pos.realizedFeesUSDT || 0) + chunk.feeOut;
    const slippageTotal = Number(pos.entrySlippageUSDT || 0) + Number(pos.realizedSlippageUSDT || 0) + chunk.slipOut;
    const totalCosts = feesTotal + slippageTotal;
    const netPnl = grossPnl - totalCosts;

    const trade = {
      ts: Date.now(),
      entryTs: pos.entryTs,
      exitTs: Date.now(),
      holdSec: Math.max(0, (Date.now() - pos.entryTs) / 1000),
      symbol: pos.symbol,
      side: pos.side,
      entryMid: pos.entryMid,
      exitMid: m,
      qtyUSDT: (Number(pos.meta?.initialQtyUSDT) || 0) > 0 ? Number(pos.meta.initialQtyUSDT) : (Number(pos.qtyUSDT) + Number(chunk.qtyUSDTClosed)),
      grossPnlUSDT: grossPnl,
      feesUSDT: feesTotal,
      slippageUSDT: slippageTotal,
      pnlUSDT: netPnl,
      reason,
      holdBars: pos.holdBars,
      tpR: pos.tpR,
      tpR1: pos.tpR1,
      tpR2: pos.tpR2,
      slR: pos.slR,
      tp1Hit: !!pos.tp1Hit,
      stopAtEntry: !!pos.stopAtEntry,
      riskUSDT: Math.max(1e-9, (Number(pos.meta?.initialQtyUSDT) || (Number(pos.qtyUSDT) + Number(chunk.qtyUSDTClosed))) * (pos.slR || 0)),
      rMultiple: (pos.slR > 0) ? netPnl / (Math.max(1e-9, (Number(pos.meta?.initialQtyUSDT) || (Number(pos.qtyUSDT) + Number(chunk.qtyUSDTClosed))) * pos.slR)) : 0,
      meta: pos.meta,
      isRiskEntry: !!pos?.meta?.isRiskEntry,
    };

    this.trades.unshift(trade);
    if (this.trades.length > 2000) this.trades.length = 2000;
    this.stats.trades += 1;
    this.stats.pnlUSDT += trade.pnlUSDT;
    this.stats.grossPnlUSDT += trade.grossPnlUSDT;
    if (trade.pnlUSDT >= 0) this.stats.wins += 1; else this.stats.losses += 1;

    this.logger?.log("paper_position_close", {
      event: reason === "tp2" ? "TP2_HIT" : (reason === "sl" ? "SL_HIT" : "POSITION_CLOSE"),
      symbol: trade.symbol,
      side: trade.side,
      reason,
      pnlUSDT: trade.pnlUSDT,
      grossPnlUSDT: trade.grossPnlUSDT,
      feesUSDT: trade.feesUSDT,
      slippageUSDT: trade.slippageUSDT,
      tp1Hit: trade.tp1Hit,
      holdBars: trade.holdBars,
    });

    this.position = null;
    this.equityUSDT = this.cashUSDT;
    this._pushEquity();
    return trade;
  }

  getSummary() {
    const runId = `paper-summary-${Math.floor((this.equityPoints[0]?.ts || Date.now()) / 1000)}`;
    const startedAt = this.equityPoints[0]?.ts || Date.now();
    const endsAt = this.equityPoints[this.equityPoints.length - 1]?.ts || Date.now();
    const durationSec = Math.max(0, (endsAt - startedAt) / 1000);

    const trades = this.trades.length;
    const wins = this.trades.filter((t) => t.pnlUSDT >= 0).length;
    const losses = trades - wins;
    const winRate = trades ? wins / trades : 0;

    const grossPnlUSDT = this.trades.reduce((a, t) => a + (t.grossPnlUSDT || 0), 0);
    const feesUSDT = this.trades.reduce((a, t) => a + (t.feesUSDT || 0), 0);
    const slippageUSDT = this.trades.reduce((a, t) => a + (t.slippageUSDT || 0), 0);
    const netPnlUSDT = this.trades.reduce((a, t) => a + (t.pnlUSDT || 0), 0);

    let peak = -Infinity;
    let maxDrawdownUSDT = 0;
    for (const p of this.equityPoints) {
      peak = Math.max(peak, p.equityUSDT);
      maxDrawdownUSDT = Math.max(maxDrawdownUSDT, peak - p.equityUSDT);
    }

    const sumProfit = this.trades.filter((t) => t.pnlUSDT > 0).reduce((a, t) => a + t.pnlUSDT, 0);
    const sumLossAbs = Math.abs(this.trades.filter((t) => t.pnlUSDT < 0).reduce((a, t) => a + t.pnlUSDT, 0));

    return {
      runId,
      startedAt,
      endsAt,
      durationSec,
      startingBalanceUSDT: this.startingBalanceUSDT,
      equityUSDT: this.equityUSDT,
      trades,
      wins,
      losses,
      winRate,
      grossPnlUSDT,
      feesUSDT,
      slippageUSDT,
      netPnlUSDT,
      netPnlBps: this.startingBalanceUSDT > 0 ? (netPnlUSDT * 10000) / this.startingBalanceUSDT : 0,
      profitFactor: sumLossAbs > 0 ? sumProfit / sumLossAbs : (sumProfit > 0 ? Infinity : 0),
      maxDrawdownUSDT,
      avgHoldSec: trades ? this.trades.reduce((a, t) => a + (t.holdSec || 0), 0) / trades : 0,
      avgR: trades ? this.trades.reduce((a, t) => a + (t.rMultiple || 0), 0) / trades : 0,
      stats: this.stats,
      notes: this.position ? "Есть открытая позиция" : "OK",
      tradesPreview: this.trades.slice(0, 20),
    };
  }

  static rollingStd(returns) {
    return std(returns || []);
  }
}
