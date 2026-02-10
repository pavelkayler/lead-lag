export const RANGE_DEFAULTS = {
  mode: "paper",
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
  maxPositions: 3,
  riskPerTradePct: 2,
  maxHoldHours: 24,
  maxNotionalTotal: 30_000,
  maxNotionalPerSymbol: 10_000,
  barPriceSource: "mark",
  scanIntervalSec: 45,
  topN: 15,
  shortlistForSignals: 12,
  minTurnover24hUSDT: 50_000_000,
  minATRPct15m: 5,
  useSpreadFilter: false,
  maxSpreadBps: 10,
  useLiquidations: true,
  useTrades: true,
  useFundingHistory: true,
  useOIHisto: true,
  useLongShortRatio: false,
  useDecouple: false,
  decoupleLookbackHours: 12,
  maxCorrToBTC: 0.8,
  atrLen: 14,
  volZWindowBars: 48,
  fundingHistLookbackDays: 7,
  absFundingThreshold: 0.003,
  useAbsFundingThreshold: false,
  liqSpikeWindowMin: 15,
  liqSpikeQuantile: 0.9,
  cvdWindowMin: 5,
  tradeOnlyCrab: false,
  strongestInImpulseOnly: true,
  strongestTopN: 3,
  w1: 1,
  w2: 1,
  w3: 1,
  w4: 1,
  pivotLen: 4,
  lookbackBars: 80,
  updateEveryNBars: 1,
  nearBandATRk: 0.4,
  triggerTwo5mClose: true,
  triggerMicroBreak: true,
  triggerHoldSec: 20,
  triggerTTLMin: 30,
  entryScheme: "50_50",
  enable25x4: false,
  addMoveMinPct: 2,
  addMoveATRk: 0.8,
  entry2TTLMin: 60,
  gridStepATRk: 0.6,
  gridLevels: 4,
  orderType: "market",
  limitOffsetBps: 4,
  slPctDefault: 4,
  slByStructure: false,
  slATRBufferK: 0.5,
  tp1Pct: 2,
  tp2Pct: 4,
  tp1ClosePct: 40,
  enableTP3: false,
  tp3Pct: 7,
  tp3OnlyMomentum: true,
  moveSlToBEAfterTP1: true,
  beBufferBps: 8,
  flatTTLMin: 90,
  hardCloseByMaxHold: true,
  enableDailyDD: false,
  dailyDDPct: 8,
  enableConsecutiveLosses: false,
  maxConsecutiveLosses: 4,
  logNoEntryEvery10s: true,
  noEntryLogIntervalSec: 10,
  slippageBps: 2,
};

export function mergeRangeConfig(partial = {}) {
  return { ...RANGE_DEFAULTS, ...(partial || {}) };
}

export function validateRangeConfig(input = {}) {
  const cfg = mergeRangeConfig(input);
  cfg.maxPositions = Math.max(1, Number(cfg.maxPositions) || 1);
  cfg.riskPerTradePct = Math.max(0.1, Number(cfg.riskPerTradePct) || 2);
  cfg.maxHoldHours = Math.max(1, Number(cfg.maxHoldHours) || 24);
  cfg.scanIntervalSec = Math.max(10, Number(cfg.scanIntervalSec) || 45);
  cfg.shortlistForSignals = Math.max(1, Number(cfg.shortlistForSignals) || 10);
  cfg.topN = Math.max(cfg.shortlistForSignals, Number(cfg.topN) || 15);
  cfg.symbols = Array.isArray(cfg.symbols) ? cfg.symbols.map((s) => String(s).toUpperCase()) : RANGE_DEFAULTS.symbols;
  return cfg;
}
