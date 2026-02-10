function roundStep(v, step) {
  if (!Number.isFinite(v) || !Number.isFinite(step) || step <= 0) return v;
  return Math.round(v / step) * step;
}

function floorStep(v, step) {
  if (!Number.isFinite(v) || !Number.isFinite(step) || step <= 0) return v;
  return Math.floor(v / step) * step;
}

export function planCycle({ side, upper, lower, spreadUsd, notionalPerOrder, tpRoiPct, slRoiPct, rules = {} }) {
  const boundary = side === "SHORT" ? upper : lower;
  const levels = [boundary, boundary + spreadUsd, boundary - spreadUsd];
  const tickSize = Number(rules.tickSize || 0);
  const qtyStep = Number(rules.qtyStep || 0);
  const minNotional = Number(rules.minNotional || 0);

  const plannedEntries = levels.map((raw, idx) => {
    const entry = tickSize > 0 ? roundStep(raw, tickSize) : raw;
    const qtyRaw = notionalPerOrder / entry;
    const qty = qtyStep > 0 ? floorStep(qtyRaw, qtyStep) : qtyRaw;
    const notional = qty * entry;
    if (minNotional > 0 && notional < minNotional) {
      const minQty = qtyStep > 0 ? Math.ceil((minNotional / entry) / qtyStep) * qtyStep : (minNotional / entry);
      return buildOrder({ idx, entry, qty: minQty, side, tpRoiPct, slRoiPct });
    }
    return buildOrder({ idx, entry, qty, side, tpRoiPct, slRoiPct });
  });

  return { boundaryPrice: boundary, plannedEntries };
}

function buildOrder({ idx, entry, qty, side, tpRoiPct, slRoiPct }) {
  const isLong = side === "LONG";
  const tpPrice = isLong ? entry * (1 + tpRoiPct / 100) : entry * (1 - tpRoiPct / 100);
  const slPrice = isLong ? entry * (1 - slRoiPct / 100) : entry * (1 + slRoiPct / 100);
  return {
    id: `E${idx + 1}`,
    side,
    entryPrice: Number(entry.toFixed(8)),
    qty: Number(qty.toFixed(8)),
    tpPrice: Number(tpPrice.toFixed(8)),
    slPrice: Number(slPrice.toFixed(8)),
  };
}
