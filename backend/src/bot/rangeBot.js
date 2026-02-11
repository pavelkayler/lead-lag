import { EventEmitter } from 'node:events';
import { selectUniverse } from './universe.js';
import { calcFeatures } from './features.js';
import { detectRegime } from './regime.js';
import { evaluateCandidate } from './fsm.js';
import { buildRiskChecks } from './risk.js';
import { normalizePrice, normalizeQty } from '../utils/math.js';

export class RangeBot extends EventEmitter {
  constructor({ env, logger, configStore, restClient, publicWs, instrumentsCache, gateway, orderManager }) {
    super();
    this.env = env;
    this.logger = logger;
    this.configStore = configStore;
    this.restClient = restClient;
    this.publicWs = publicWs;
    this.instrumentsCache = instrumentsCache;
    this.gateway = gateway;
    this.orderManager = orderManager;

    this.running = false;
    this.universe = [];
    this.candidates = [];
    this.market = new Map();
    this.lastSignalTime = null;

    this.publicWs.onMessage((msg) => this.onPublicMessage(msg));
    if (this.gateway.on) {
      this.gateway.on('execution', (payload) => this.emitEvent('execution', payload));
      this.gateway.on('fill', (payload) => this.emitEvent('execution', payload));
    }
  }

  emitEvent(kind, payload) {
    this.emit('event', { type: 'event', topic: 'rangeMetrics', payload: { kind, ...payload, ts: Date.now() } });
  }

  async start() {
    this.running = true;
    await this.instrumentsCache.refresh();
    this.publicWs.connect();
    await this.refreshUniverse();
    this.loop = setInterval(() => this.tick().catch((e) => this.emitEvent('error', { message: e.message })), 5000);
    this.universeLoop = setInterval(() => this.refreshUniverse().catch(() => {}), 15 * 60 * 1000);
    this.emitEvent('status', this.getStatus());
  }

  stop() {
    this.running = false;
    clearInterval(this.loop);
    clearInterval(this.universeLoop);
    this.emitEvent('status', this.getStatus());
  }

  async emergencyStop(closePositions = false) {
    this.stop();
    const result = await this.gateway.emergencyStop(closePositions);
    this.emitEvent('log', { message: 'Emergency stop executed', result });
    return result;
  }

  async refreshUniverse() {
    const config = this.configStore.get();
    this.universe = await selectUniverse(this.restClient, config);
    const topics = [];
    for (const s of this.universe) {
      topics.push(`tickers.${s}`);
      topics.push(`publicTrade.${s}`);
      topics.push(`kline.5.${s}`);
      topics.push(`allLiquidation.${s}`);
    }
    this.publicWs.subscribe(topics);
    this.emitEvent('status', this.getStatus());
  }

  onPublicMessage(msg) {
    const topic = msg.topic || '';
    if (!topic || !msg.data) return;
    if (topic.startsWith('tickers.')) {
      const symbol = topic.split('.')[1];
      const prev = this.market.get(symbol) || { volumes: [] };
      const t = Array.isArray(msg.data) ? msg.data[0] : msg.data;
      this.market.set(symbol, {
        ...prev,
        symbol,
        lastPrice: Number(t.lastPrice || t.markPrice || prev.lastPrice || 0),
        nearSupport: Math.random() < 0.1,
        nearResistance: Math.random() < 0.1,
        atrPct15m: Number(t.price24hPcnt || 0) * 100
      });
      if (this.env.TRADING_MODE === 'paper') this.gateway.onTick(symbol, Number(t.lastPrice || 0));
    }
    if (topic.startsWith('publicTrade.')) {
      const symbol = topic.split('.')[1];
      const prev = this.market.get(symbol) || { volumes: [] };
      const trades = Array.isArray(msg.data) ? msg.data : [msg.data];
      let delta = prev.cvdSlope || 0;
      for (const tr of trades) {
        const qty = Number(tr.v || tr.size || 0);
        prev.volumes = [...(prev.volumes || []).slice(-80), qty];
        delta += tr.S === 'Buy' ? qty : -qty;
      }
      this.market.set(symbol, { ...prev, cvdSlope: delta });
    }
    if (topic.startsWith('allLiquidation.')) {
      const symbol = topic.split('.')[1];
      const prev = this.market.get(symbol) || { volumes: [] };
      const liqs = Array.isArray(msg.data) ? msg.data : [msg.data];
      let liqLong15m = prev.liqLong15m || 0;
      let liqShort15m = prev.liqShort15m || 0;
      for (const liq of liqs) {
        const value = Number(liq.v || liq.value || 0) * Number(liq.p || liq.price || 0);
        if (liq.S === 'Buy') liqShort15m += value;
        else liqLong15m += value;
      }
      this.market.set(symbol, { ...prev, liqLong15m, liqShort15m });
    }
  }

  async tick() {
    if (!this.running) return;
    const config = this.configStore.get();
    const regime = detectRegime([{ close: 1 }, { close: 1.01 }, { close: 1.02 }, { close: 1.01 }]);
    const risk = buildRiskChecks(this.env, config);
    this.candidates = [];
    for (const symbol of this.universe) {
      const state = this.market.get(symbol);
      if (!state?.lastPrice) continue;
      const features = calcFeatures(state);
      const candidate = evaluateCandidate(symbol, features, config);
      if (!candidate) continue;
      this.candidates.push(candidate);
      this.lastSignalTime = Date.now();
      this.emitEvent('plan', { symbol, candidate, regime, risk });
      if (this.running && risk.canEnter && (!config.tradeOnlyCrab || regime.regime === 'CRAB')) {
        await this.executeCandidate(candidate, state.lastPrice, config);
      }
    }
    this.emitEvent('candidates', { candidates: this.candidates });
    this.emitEvent('status', this.getStatus());
  }

  async executeCandidate(candidate, lastPrice, config) {
    const instrument = this.instrumentsCache.get(candidate.symbol);
    const qty = normalizeQty(1, instrument);
    const price = normalizePrice(lastPrice, instrument);
    const orderLinkId = this.orderManager.createOrderLinkId(candidate.symbol, candidate.side, 'entry1');
    await this.gateway.placeOrder({ symbol: candidate.symbol, side: candidate.side, type: 'Market', qty, price, orderLinkId }, lastPrice);

    const stopSide = candidate.side === 'Buy' ? 'Sell' : 'Buy';
    const slPrice = candidate.side === 'Buy' ? price * (1 - config.slPctDefault / 100) : price * (1 + config.slPctDefault / 100);
    await this.gateway.placeOrder({
      symbol: candidate.symbol,
      side: stopSide,
      type: 'Stop',
      qty,
      stopPrice: normalizePrice(slPrice, instrument),
      reduceOnly: true,
      orderLinkId: this.orderManager.createOrderLinkId(candidate.symbol, stopSide, 'sl')
    }, lastPrice);
  }

  getStatus() {
    return {
      running: this.running,
      tradingMode: this.env.TRADING_MODE,
      enableTrading: this.env.ENABLE_TRADING,
      bybitEnv: this.env.BYBIT_ENV,
      symbols: this.universe.length,
      candidates: this.candidates.length,
      positions: this.gateway.getPositions ? this.gateway.getPositions().length : 0,
      lastSignalTime: this.lastSignalTime
    };
  }

  getUniverse() {
    return this.universe;
  }

  getCandidates() {
    return this.candidates;
  }
}
