export class ExecutionGateway {
  async placeOrder(_order) {
    throw new Error('Not implemented');
  }
  async cancelOrder(_orderId) {
    throw new Error('Not implemented');
  }
  async emergencyStop(_closePositions) {
    throw new Error('Not implemented');
  }
  getPositions() {
    return [];
  }
  getOpenOrders() {
    return [];
  }
}
