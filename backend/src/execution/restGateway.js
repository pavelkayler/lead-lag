import { EventEmitter } from 'node:events';

export class RestGateway extends EventEmitter {
  constructor(restClient, logger) {
    super();
    this.restClient = restClient;
    this.logger = logger;
  }

  async placeOrder(order) {
    const payload = {
      category: 'linear',
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      qty: String(order.qty),
      price: order.price ? String(order.price) : undefined,
      triggerPrice: order.stopPrice ? String(order.stopPrice) : undefined,
      reduceOnly: order.reduceOnly || false,
      orderLinkId: order.orderLinkId
    };
    const result = await this.restClient.placeOrder(payload);
    this.emit('execution', { kind: 'restOrderCreate', payload: result });
    return result;
  }

  async cancelOrder(symbol, orderId) {
    return this.restClient.cancelOrder({ category: 'linear', symbol, orderId });
  }

  async emergencyStop(closePositions = false) {
    this.logger.warn({ closePositions }, 'Emergency stop on REST gateway');
    return { closePositions };
  }

  async getPositions(symbol) {
    return this.restClient.getPositions(symbol);
  }
}
