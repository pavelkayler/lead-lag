let seq = 1;

export class OrderManager {
  createOrderLinkId(symbol, side, type = 'entry') {
    return `${type}-${symbol}-${side}-${Date.now()}-${seq++}`;
  }
}
