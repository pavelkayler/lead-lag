import { z } from 'zod';

export const RangeConfigSchema = z.object({
  symbol: z.string().default('BTCUSDT'),
  timeframe: z.enum(['1m', '5m', '15m']).default('5m'),
  riskPerTradePct: z.number().min(0.1).max(5).default(1),
  moveSlToBeAtTp1: z.boolean().default(true),
  maxHoldMinutes: z.number().min(5).max(360).default(90),
  mode: z.enum(['paper', 'demo', 'real']).default('paper'),
  useTradeWsInReal: z.boolean().default(true),
  dailyDrawdownLimitPct: z.number().min(1).max(20).default(8),
  maxConsecutiveLosses: z.number().min(1).max(12).default(4),
  emergencyStop: z.boolean().default(false)
});

export type RangeConfig = z.infer<typeof RangeConfigSchema>;

export const rangeConfigUiSchema = [
  { key: 'symbol', label: 'Торговый символ', description: 'Линейный perpetual символ Bybit.', group: 'General', default: 'BTCUSDT', example: 'ETHUSDT' },
  { key: 'timeframe', label: 'ТФ', description: 'Базовый таймфрейм для setup/trigger.', group: 'General', default: '5m', enum: ['1m', '5m', '15m'] },
  { key: 'riskPerTradePct', label: 'Риск на сделку', description: 'Риск в процентах от equity для расчёта размера позиции.', group: 'Risk', default: 1, min: 0.1, max: 5, step: 0.1, unit: '%' },
  { key: 'maxHoldMinutes', label: 'Max hold', description: 'Time-stop для позиции.', group: 'Risk', default: 90, min: 5, max: 360, step: 5, unit: 'min' },
  { key: 'mode', label: 'Режим исполнения', description: 'paper/demo/real.', group: 'Execution', default: 'paper', enum: ['paper', 'demo', 'real'] },
  { key: 'useTradeWsInReal', label: 'WS gateway для real', description: 'В real режиме ордера отправляются через Trade WS.', group: 'Execution', default: true, advanced: true },
  { key: 'moveSlToBeAtTp1', label: 'SL -> BE после TP1', description: 'После частичной фиксации TP1 стоп переносится в безубыток.', group: 'Management', default: true },
  { key: 'dailyDrawdownLimitPct', label: 'Daily DD лимит', description: 'Остановка новых входов при превышении дневной просадки.', group: 'Safety', default: 8, min: 1, max: 20, step: 1, unit: '%' },
  { key: 'maxConsecutiveLosses', label: 'Макс. подряд убыточных', description: 'Остановка стратегии по серии убыточных сделок.', group: 'Safety', default: 4, min: 1, max: 12, step: 1 },
  { key: 'emergencyStop', label: 'Emergency stop', description: 'Мгновенно отключает новые ордера и закрывает активное управление.', group: 'Safety', default: false, advanced: true }
] as const;
