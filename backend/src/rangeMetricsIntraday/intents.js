export function makeNoTrade(symbol, reasons = [], details = {}) {
  return { symbol, outcome: "NO_TRADE", reasons, details, ts: Date.now() };
}

export function makeTradePlan({ symbol, side, entries, sl, tps, timeouts, notes = "" }) {
  return { symbol, side, entries, sl, tps, timeouts, notes };
}

export function makeExecutionIntent(actions = []) {
  return { ts: Date.now(), actions };
}

export function makeManagementIntent(actions = []) {
  return { ts: Date.now(), actions };
}

export function blocker(code, label, value, threshold, pass) {
  return { code, label, value, threshold, pass: !!pass };
}
