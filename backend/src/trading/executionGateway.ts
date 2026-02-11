export type OrderInput = { symbol: string; side: 'Buy' | 'Sell'; qty: number; price?: number; stopLoss?: number; takeProfit?: number };
export type OrderResult = { orderId: string; status: 'created' | 'cancelled' | 'amended'; transport: string };

export interface ExecutionGateway {
  createOrder(input: OrderInput): Promise<OrderResult>;
  amendOrder(orderId: string, input: Partial<OrderInput>): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<OrderResult>;
}

class PaperGateway implements ExecutionGateway {
  async createOrder(): Promise<OrderResult> { return { orderId: `paper-${Date.now()}`, status: 'created', transport: 'paper' }; }
  async amendOrder(orderId: string): Promise<OrderResult> { return { orderId, status: 'amended', transport: 'paper' }; }
  async cancelOrder(orderId: string): Promise<OrderResult> { return { orderId, status: 'cancelled', transport: 'paper' }; }
}
class BybitRestGateway extends PaperGateway { async createOrder(i: OrderInput){ return { ...(await super.createOrder(i)), transport: 'bybit-rest' }; } }
class BybitTradeWsGateway extends PaperGateway { async createOrder(i: OrderInput){ return { ...(await super.createOrder(i)), transport: 'bybit-trade-ws' }; } }

export function createExecutionGateway(mode = process.env.EXECUTION_MODE || 'paper'): ExecutionGateway {
  if (mode === 'demo') return new BybitRestGateway();
  if (mode === 'real') return (process.env.BYBIT_REAL_TRANSPORT || 'ws') === 'ws' ? new BybitTradeWsGateway() : new BybitRestGateway();
  return new PaperGateway();
}

export function roundToStep(value: number, step: number, mode: 'floor' | 'ceil' = 'floor') {
  const n = value / step;
  const k = mode === 'ceil' ? Math.ceil(n) : Math.floor(n);
  return Number((k * step).toFixed(12));
}

export function calcOrderQty(equity: number, riskPct: number, entry: number, stop: number, qtyStep: number, minQty: number) {
  const riskAmount = equity * (riskPct / 100);
  const slDistance = Math.max(Math.abs(entry - stop), 1e-9);
  const raw = riskAmount / slDistance;
  return Math.max(minQty, roundToStep(raw, qtyStep, 'floor'));
}
