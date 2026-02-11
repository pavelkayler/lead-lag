import { EventEmitter } from 'node:events';

let seq = 1;

export class PaperGateway extends EventEmitter {
  constructor(logger, configStore) {
    super();
    this.logger = logger;
    this.configStore = configStore;
    this.orders = new Map();
    this.positions = new Map();
  }

  placeOrder(order, marketPrice) {
    const id = `paper-${Date.now()}-${seq++}`;
    const full = { ...order, orderId: id, status: 'open', createdAt: Date.now() };
    this.orders.set(id, full);

    if (order.type === 'Market') {
      this.execute(full, marketPrice);
    }
    return full;
  }

  onTick(symbol, price) {
    for (const order of this.orders.values()) {
      if (order.symbol !== symbol || order.status !== 'open') continue;
      if (order.type === 'Limit') {
        const touched = (order.side === 'Buy' && price <= order.price) || (order.side === 'Sell' && price >= order.price);
        if (touched) this.execute(order, order.price);
      }
      if (order.type === 'Stop') {
        const triggered = (order.side === 'Buy' && price >= order.stopPrice) || (order.side === 'Sell' && price <= order.stopPrice);
        if (triggered) this.execute(order, price);
      }
    }
  }

  execute(order, basePrice) {
    const bps = this.configStore.get().paperSlippageBps;
    const slip = 1 + ((order.side === 'Buy' ? 1 : -1) * bps) / 10000;
    const fillPrice = Number((basePrice * slip).toFixed(6));
    order.status = 'filled';
    order.fillPrice = fillPrice;
    const posKey = `${order.symbol}:${order.side}`;
    this.positions.set(posKey, { symbol: order.symbol, side: order.side, qty: order.qty, entryPrice: fillPrice, openedAt: Date.now() });
    this.emit('fill', { order, fillPrice });
    this.logger.info({ orderId: order.orderId, symbol: order.symbol, fillPrice }, 'Paper fill');
  }

  cancelOrder(orderId) {
    const order = this.orders.get(orderId);
    if (order) order.status = 'cancelled';
    return order;
  }

  emergencyStop(closePositions = false) {
    for (const order of this.orders.values()) {
      if (order.status === 'open') order.status = 'cancelled';
    }
    if (closePositions) this.positions.clear();
    return { cancelled: true, closed: closePositions };
  }

  getPositions() {
    return [...this.positions.values()];
  }

  getOpenOrders() {
    return [...this.orders.values()].filter((o) => o.status === 'open');
  }
}
