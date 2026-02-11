import { EventEmitter } from 'node:events';

export type Tick = { symbol: string; last: number; mark: number; ts: number };

export class BybitPublicFeed extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private symbols = ['BTCUSDT'];
  private prices = new Map<string, Tick>();
  setSymbols(symbols: string[]) { this.symbols = symbols.length ? symbols : this.symbols; }
  getSnapshot() { return Object.fromEntries(this.prices); }
  start() {
    this.stop();
    this.timer = setInterval(async () => {
      for (const symbol of this.symbols) {
        const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`).then((x) => x.json()).catch(() => null) as any;
        const row = r?.result?.list?.[0];
        if (!row) continue;
        const tick = { symbol, last: Number(row.lastPrice || 0), mark: Number(row.markPrice || row.lastPrice || 0), ts: Date.now() };
        this.prices.set(symbol, tick);
        this.emit('tick', tick);
      }
    }, 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
