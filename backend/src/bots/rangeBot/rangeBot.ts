import { RangeConfigStore } from '../../storage/configStore.js';
import { BotStateStore } from '../../storage/stateStore.js';
import { ExecutionGateway, calcOrderQty } from '../../trading/executionGateway.js';
import { BybitPublicFeed, Tick } from '../../feed/bybitPublicFeed.js';
import { detectRegime } from './regimeDetector.js';
import { supportResistance } from './rangeModel.js';

type Deps = { configStore: RangeConfigStore; stateStore: BotStateStore; gateway: ExecutionGateway; feed: BybitPublicFeed };

export function createRangeBot(deps: Deps) {
  const prices: number[] = [];
  let running = false;
  let position: null | { side: 'Buy' | 'Sell'; entry: number; qty: number; openedAt: number; orderId: string; tp1Hit?: boolean } = null;

  const onTick = async (t: Tick) => {
    if (!running) return;
    prices.push(t.last); if (prices.length > 200) prices.shift();
    const cfg = deps.configStore.get();
    if (cfg.emergencyStop) return;
    if (!position && prices.length > 30) {
      const rets = prices.slice(-20).map((v, i, arr) => i === 0 ? 0 : (v - arr[i - 1]) / arr[i - 1]).slice(1);
      const regime = detectRegime(rets);
      const { support, resistance } = supportResistance(prices.slice(-60));
      const nearSupport = Math.abs(t.last - support) / Math.max(t.last, 1) < 0.004;
      const nearResistance = Math.abs(t.last - resistance) / Math.max(t.last, 1) < 0.004;
      const side: 'Buy' | 'Sell' | null = regime === 'CRAB' ? (nearSupport ? 'Buy' : nearResistance ? 'Sell' : null) : null;
      if (side) {
        const stop = side === 'Buy' ? t.last * 0.995 : t.last * 1.005;
        const qty = calcOrderQty(1000, cfg.riskPerTradePct, t.last, stop, 0.001, 0.001);
        const order = await deps.gateway.createOrder({ symbol: cfg.symbol, side, qty, price: t.last, stopLoss: stop });
        position = { side, entry: t.last, qty, openedAt: Date.now(), orderId: order.orderId };
      }
    } else if (position) {
      const pnl = position.side === 'Buy' ? (t.last - position.entry) / position.entry : (position.entry - t.last) / position.entry;
      if (!position.tp1Hit && pnl > 0.0025) { position.tp1Hit = true; }
      const shouldClose = pnl < -0.005 || pnl > 0.006 || (Date.now() - position.openedAt) > cfg.maxHoldMinutes * 60_000;
      if (shouldClose) { await deps.gateway.cancelOrder(position.orderId); position = null; }
    }
    deps.stateStore.save({ running, position, updatedAt: Date.now() });
  };

  return {
    start() { if (!running) { running = true; deps.feed.on('tick', onTick); } },
    stop() { running = false; deps.feed.off('tick', onTick); deps.stateStore.save({ running, position: null, updatedAt: Date.now() }); },
    state() { return { running, position }; }
  };
}
