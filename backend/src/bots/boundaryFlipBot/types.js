export const DEFAULT_BOUNDARY_FLIP_CONFIG = {
  symbol: "BTCUSDT",
  timeframe: "15m",
  firstSide: "SHORT",
  tpRoiPct: 0.8,
  slRoiPct: 0.6,
  spreadUsd: 12,
  notionalPerOrder: 30,
  mode: "paper",
  enableEarlyExit: true,
  minEarlyProfitPct: 0.3,
  minReverseBodyPct: 0.5,
  minBodyToRangeRatio: 0.6,
};

export function normalizeConfig(cfg = {}) {
  const firstSide = String(cfg.firstSide || cfg.side || "SHORT").toUpperCase() === "LONG" ? "LONG" : "SHORT";
  const timeframe = ["5m", "15m", "1h"].includes(cfg.timeframe) ? cfg.timeframe : "15m";
  const mode = ["paper", "demo", "real"].includes(cfg.mode) ? cfg.mode : "paper";
  return {
    ...DEFAULT_BOUNDARY_FLIP_CONFIG,
    ...cfg,
    symbol: String(cfg.symbol || DEFAULT_BOUNDARY_FLIP_CONFIG.symbol).toUpperCase(),
    timeframe,
    firstSide,
    tpRoiPct: Math.max(0.05, Number(cfg.tpRoiPct ?? DEFAULT_BOUNDARY_FLIP_CONFIG.tpRoiPct)),
    slRoiPct: Math.max(0.05, Number(cfg.slRoiPct ?? DEFAULT_BOUNDARY_FLIP_CONFIG.slRoiPct)),
    spreadUsd: Math.max(0, Number(cfg.spreadUsd ?? DEFAULT_BOUNDARY_FLIP_CONFIG.spreadUsd)),
    notionalPerOrder: Math.max(1, Number(cfg.notionalPerOrder ?? DEFAULT_BOUNDARY_FLIP_CONFIG.notionalPerOrder)),
    mode,
    enableEarlyExit: cfg.enableEarlyExit !== false,
    minEarlyProfitPct: Math.max(0, Number(cfg.minEarlyProfitPct ?? DEFAULT_BOUNDARY_FLIP_CONFIG.minEarlyProfitPct)),
    minReverseBodyPct: Math.max(0, Number(cfg.minReverseBodyPct ?? DEFAULT_BOUNDARY_FLIP_CONFIG.minReverseBodyPct)),
    minBodyToRangeRatio: Math.max(0, Number(cfg.minBodyToRangeRatio ?? DEFAULT_BOUNDARY_FLIP_CONFIG.minBodyToRangeRatio)),
  };
}

export function makeInitialStatus(config) {
  return {
    state: "STOPPED",
    mode: config.mode,
    symbol: config.symbol,
    tf: config.timeframe,
    currentSide: config.firstSide,
    upper: null,
    lower: null,
    boundaryPrice: null,
    plannedEntries: [],
    openOrders: [],
    position: null,
    cycleId: 0,
    lastCycleReason: null,
    lastError: null,
    updatedAt: Date.now(),
  };
}
