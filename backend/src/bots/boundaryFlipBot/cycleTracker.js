import { getLastClosedBar } from "./levels.js";

const TF_TO_BYBIT = { "5m": "5", "15m": "15", "1h": "60" };

export class CycleTracker {
  constructor({ rest, executor, logger = null }) {
    this.rest = rest;
    this.executor = executor;
    this.logger = logger;
  }

  async getMark(symbol) {
    const t = await this.rest.publicGet("/v5/market/tickers", { category: "linear", symbol });
    return Number(t?.result?.list?.[0]?.markPrice || t?.result?.list?.[0]?.lastPrice || NaN);
  }

  async getLastClosedTfBar(symbol, timeframe = "15m") {
    const interval = TF_TO_BYBIT[timeframe] || "15";
    try {
      const resp = await this.rest.publicGet("/v5/market/kline", { category: "linear", symbol, interval, limit: 3 });
      const list = Array.isArray(resp?.result?.list) ? resp.result.list : [];
      const bar = list[1] || list[0];
      if (!bar) return null;
      return {
        ts: Number(bar[0]),
        open: Number(bar[1]),
        high: Number(bar[2]),
        low: Number(bar[3]),
        close: Number(bar[4]),
      };
    } catch {
      return null;
    }
  }

  _isEntryHit(side, mark, entryPrice) {
    return side === "LONG" ? mark <= entryPrice : mark >= entryPrice;
  }

  _updatePositionFromFills(cycle, fills = []) {
    if (!fills.length) return false;
    const qtyAdd = fills.reduce((acc, x) => acc + Number(x.qty || 0), 0);
    const notionalAdd = fills.reduce((acc, x) => acc + Number(x.qty || 0) * Number(x.entryPrice || 0), 0);
    if (!cycle.position) {
      const avgEntry = qtyAdd > 0 ? (notionalAdd / qtyAdd) : 0;
      cycle.position = {
        side: cycle.side,
        qty: Number(qtyAdd.toFixed(8)),
        avgEntry: Number(avgEntry.toFixed(8)),
        openedAt: Date.now(),
        filledOrderIds: fills.map((x) => x.orderId || x.id),
      };
      return true;
    }
    const curQty = Number(cycle.position.qty || 0);
    const curAvg = Number(cycle.position.avgEntry || 0);
    const totalQty = curQty + qtyAdd;
    if (totalQty <= 0) return false;
    const totalNotional = (curQty * curAvg) + notionalAdd;
    cycle.position.qty = Number(totalQty.toFixed(8));
    cycle.position.avgEntry = Number((totalNotional / totalQty).toFixed(8));
    cycle.position.filledOrderIds = Array.from(new Set([...(cycle.position.filledOrderIds || []), ...fills.map((x) => x.orderId || x.id)]));
    return false;
  }

  _calcTpSl(position, config) {
    const isLong = position.side === "LONG";
    const avg = Number(position.avgEntry || 0);
    return {
      tpPrice: isLong ? avg * (1 + config.tpRoiPct / 100) : avg * (1 - config.tpRoiPct / 100),
      slPrice: isLong ? avg * (1 - config.slRoiPct / 100) : avg * (1 + config.slRoiPct / 100),
    };
  }

  _calcNearTp(position, config, mark) {
    const isLong = position.side === "LONG";
    const avg = Number(position.avgEntry || 0);
    const tpPct = Number(config.tpRoiPct || 0);
    const tpPrice = isLong ? avg * (1 + tpPct / 100) : avg * (1 - tpPct / 100);
    const nearStartRoi = Math.max(0, tpPct - (tpPct * Number(config.nearTpWindowPct || 0) / 100));
    const nearStartPrice = isLong ? avg * (1 + nearStartRoi / 100) : avg * (1 - nearStartRoi / 100);
    const inZone = isLong
      ? (mark >= nearStartPrice && mark < tpPrice)
      : (mark <= nearStartPrice && mark > tpPrice);
    return { tpPrice, nearStartRoi, nearStartPrice, inZone };
  }

  _calcCandleStrength(position, bar) {
    const eps = 1e-9;
    const close = Number(bar?.close || 0);
    const open = Number(bar?.open || 0);
    const high = Number(bar?.high || 0);
    const low = Number(bar?.low || 0);
    const bodyAbs = Math.abs(close - open);
    const bodyPct = (bodyAbs / Math.max(eps, Math.abs(close))) * 100;
    const range = Math.max(eps, high - low);
    const bodyToRange = bodyAbs / range;
    const reverse = position.side === "LONG" ? (close < open) : (close > open);
    return { reverse, bodyPct, bodyToRange };
  }

  async evaluate({ config, cycle, levels }) {
    const mark = await this.getMark(config.symbol);
    if (!Number.isFinite(mark)) return { action: null };

    const fills = (cycle.openOrders || []).filter((o) => !o.filledAt && this._isEntryHit(cycle.side, mark, Number(o.entryPrice || 0)));
    for (const fill of fills) fill.filledAt = Date.now();
    const isNewPosition = this._updatePositionFromFills(cycle, fills);
    if (isNewPosition) {
      const { tpPrice, slPrice } = this._calcTpSl(cycle.position, config);
      cycle.position.tpPrice = Number(tpPrice.toFixed(8));
      cycle.position.slPrice = Number(slPrice.toFixed(8));
      return { action: "position_opened", mark };
    }

    if (!cycle.position) return { action: null };

    const p = cycle.position;
    const { tpPrice, slPrice } = this._calcTpSl(p, config);
    p.tpPrice = Number(tpPrice.toFixed(8));
    p.slPrice = Number(slPrice.toFixed(8));
    const pnlPct = p.side === "LONG" ? ((mark / p.avgEntry) - 1) * 100 : ((p.avgEntry / mark) - 1) * 100;
    const tpHit = p.side === "LONG" ? mark >= p.tpPrice : mark <= p.tpPrice;
    const slHit = p.side === "LONG" ? mark <= p.slPrice : mark >= p.slPrice;
    if (tpHit) return { action: "close", reason: "TP", mark, pnlPct };
    if (slHit) return { action: "close", reason: "SL", mark, pnlPct };

    if (!config.enableNearTpEarlyExit) return { action: null };

    const near = this._calcNearTp(p, config, mark);
    if (!near.inZone) return { action: null };
    if (pnlPct < Number(config.minTakeRoiPct || 0)) return { action: null };

    if (!cycle.nearTpState) cycle.nearTpState = { enteredAt: Date.now(), peakPrice: mark };
    const peak = Number(cycle.nearTpState.peakPrice || mark);
    cycle.nearTpState.peakPrice = p.side === "LONG" ? Math.max(peak, mark) : Math.min(peak, mark);

    let pullbackOk = true;
    if (config.usePullbackFromPeak) {
      const pullbackPct = Number(config.pullbackPctFromPeak || 0);
      const peakPrice = Number(cycle.nearTpState.peakPrice || mark);
      pullbackOk = p.side === "LONG"
        ? mark <= peakPrice * (1 - pullbackPct / 100)
        : mark >= peakPrice * (1 + pullbackPct / 100);
    }
    if (!pullbackOk) return { action: null };

    const bar = (await this.getLastClosedTfBar(config.symbol, config.timeframe)) || getLastClosedBar(levels);
    const candle = this._calcCandleStrength(p, bar);
    let candleOk = true;
    if (config.reverseCandleRequired) {
      candleOk = !!bar
        && candle.reverse
        && candle.bodyPct >= Number(config.minReverseBodyPct || 0)
        && candle.bodyToRange >= Number(config.minBodyToRangeRatio || 0);
    }
    if (!candleOk) return { action: null };

    return {
      action: "close",
      reason: "EARLY",
      mark,
      pnlPct,
      earlyMeta: {
        tpPrice: Number(near.tpPrice.toFixed(8)),
        nearStartPrice: Number(near.nearStartPrice.toFixed(8)),
        nearStartRoi: Number(near.nearStartRoi.toFixed(4)),
        peakPrice: Number((cycle.nearTpState?.peakPrice || mark).toFixed(8)),
        pullbackPctFromPeak: Number(config.pullbackPctFromPeak || 0),
        candleBodyPct: Number(candle.bodyPct.toFixed(4)),
        bodyToRange: Number(candle.bodyToRange.toFixed(4)),
      },
    };
  }
}
