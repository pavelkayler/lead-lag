export class InstrumentsCache {
  constructor(restClient, logger) {
    this.restClient = restClient;
    this.logger = logger;
    this.map = new Map();
  }

  async refresh() {
    const list = await this.restClient.getInstruments();
    this.map.clear();
    for (const item of list) {
      this.map.set(item.symbol, {
        symbol: item.symbol,
        tickSize: Number(item.priceFilter?.tickSize || 0.1),
        qtyStep: Number(item.lotSizeFilter?.qtyStep || 0.001),
        minQty: Number(item.lotSizeFilter?.minOrderQty || 0.001)
      });
    }
    this.logger.info({ count: this.map.size }, 'Instruments cache refreshed');
  }

  get(symbol) {
    return this.map.get(symbol) || { symbol, tickSize: 0.1, qtyStep: 0.001, minQty: 0.001 };
  }
}
