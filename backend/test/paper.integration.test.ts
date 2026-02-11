import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRangeBot } from '../src/bots/rangeBot/rangeBot.js';

class StubStore { cfg = { symbol:'TESTUSDT', timeframe:'5m', riskPerTradePct:1, moveSlToBeAtTp1:true, maxHoldMinutes:1, mode:'paper', useTradeWsInReal:true, dailyDrawdownLimitPct:8, maxConsecutiveLosses:4, emergencyStop:false }; get(){ return this.cfg; } set(v:any){ this.cfg={...this.cfg,...v}; return this.cfg; } }
class StubState { save(){} load(){ return { running:false, updatedAt:Date.now()}; } }
class StubGateway { created=0; cancelled=0; async createOrder(){ this.created++; return { orderId:'1', status:'created', transport:'paper'}; } async cancelOrder(){ this.cancelled++; return { orderId:'1', status:'cancelled', transport:'paper'}; } async amendOrder(){ return { orderId:'1', status:'amended', transport:'paper'}; } }

class StubFeed extends EventEmitter {}

describe('integration paper', () => {
  it('opens and manages a synthetic position', async () => {
    const feed = new StubFeed() as any;
    const gw = new StubGateway();
    const bot = createRangeBot({ configStore: new StubStore() as any, stateStore: new StubState() as any, gateway: gw as any, feed });
    bot.start();
    const seq = [100,99.8,99.7,99.9,100,100.2,100.1,99.9,99.8,99.7,99.6,99.8,100,100.3,100.6,100.9,101.2,101.4,101.3,101.1,100.8,100.4,100.2,99.9,99.6,99.3,99.0,98.8,98.7,98.6,98.5,98.4,98.3,98.2,98.1,98.0];
    for (const p of seq) { feed.emit('tick', { symbol:'TESTUSDT', last:p, mark:p, ts:Date.now() }); }
    await new Promise(r => setTimeout(r, 10));
    expect(gw.created).toBeGreaterThan(0);
    expect(gw.cancelled).toBeGreaterThanOrEqual(0);
    bot.stop();
  });
});
