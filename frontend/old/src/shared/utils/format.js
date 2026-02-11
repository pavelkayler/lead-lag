export function toNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function fmtMs(v) {
  const n = toNum(v);
  if (n == null) return "-";
  if (n < 1) return `${n.toFixed(3)}ms`;
  if (n < 1000) return `${n.toFixed(1)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

export function fmtNum(v, digits = 6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

export function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

export function makeId(prefix = "req") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
