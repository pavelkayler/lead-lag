import { EventEmitter } from 'node:events';

let seq = 1;

export class WsGateway extends EventEmitter {
  constructor(tradeWs, restGateway, logger) {
    super();
    this.tradeWs = tradeWs;
    this.restGateway = restGateway;
    this.logger = logger;
    this.tradeWs.onMessage((msg) => this.emit('execution', msg));
  }

  async placeOrder(order) {
    const reqId = `ws-${Date.now()}-${seq++}`;
    const payload = {
      reqId,
      op: 'order.create',
      args: [{
        category: 'linear',
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        qty: String(order.qty),
        price: order.price ? String(order.price) : undefined,
        triggerPrice: order.stopPrice ? String(order.stopPrice) : undefined,
        reduceOnly: order.reduceOnly || false,
        orderLinkId: order.orderLinkId
      }]
    };
    if (!this.tradeWs.connected) {
      this.logger.warn('Trade WS unavailable, fallback to REST');
      return this.restGateway.placeOrder(order);
    }
    this.tradeWs.send(payload);
    return { reqId, via: 'ws' };
  }

  async cancelOrder(order) {
    if (!this.tradeWs.connected) return this.restGateway.cancelOrder(order.symbol, order.orderId);
    const payload = {
      reqId: `cancel-${Date.now()}-${seq++}`,
      op: 'order.cancel',
      args: [{ category: 'linear', symbol: order.symbol, orderId: order.orderId }]
    };
    this.tradeWs.send(payload);
    return { ok: true, via: 'ws' };
  }

  async emergencyStop(closePositions = false) {
    this.logger.warn({ closePositions }, 'Emergency stop in WS gateway');
    return this.restGateway.emergencyStop(closePositions);
  }
}
