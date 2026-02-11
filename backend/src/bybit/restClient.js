import axios from 'axios';
import crypto from 'node:crypto';

const BASES = {
  demo: 'https://api-demo.bybit.com',
  testnet: 'https://api-testnet.bybit.com',
  mainnet: 'https://api.bybit.com'
};

export class BybitRestClient {
  constructor(env, logger) {
    this.env = env;
    this.logger = logger;
    this.http = axios.create({
      baseURL: BASES[env.BYBIT_ENV],
      timeout: 10000
    });
  }

  sign(params = {}) {
    const ts = Date.now().toString();
    const recv = '5000';
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('&');
    const payload = `${ts}${this.env.BYBIT_API_KEY}${recv}${query}`;
    const sign = crypto.createHmac('sha256', this.env.BYBIT_API_SECRET).update(payload).digest('hex');
    return {
      'X-BAPI-API-KEY': this.env.BYBIT_API_KEY,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': recv,
      'X-BAPI-SIGN': sign
    };
  }

  async getInstruments() {
    const { data } = await this.http.get('/v5/market/instruments-info', { params: { category: 'linear', limit: 1000 } });
    return data.result?.list || [];
  }

  async getTickers() {
    const { data } = await this.http.get('/v5/market/tickers', { params: { category: 'linear' } });
    return data.result?.list || [];
  }

  async getOpenInterest(symbol, intervalTime = '15min') {
    const { data } = await this.http.get('/v5/market/open-interest', { params: { category: 'linear', symbol, intervalTime, limit: 2 } });
    return data.result?.list || [];
  }

  async getFunding(symbol) {
    const { data } = await this.http.get('/v5/market/funding/history', { params: { category: 'linear', symbol, limit: 1 } });
    return data.result?.list?.[0] || null;
  }

  async placeOrder(params) {
    const headers = this.sign(params);
    const { data } = await this.http.post('/v5/order/create', params, { headers });
    return data;
  }

  async cancelOrder(params) {
    const headers = this.sign(params);
    const { data } = await this.http.post('/v5/order/cancel', params, { headers });
    return data;
  }

  async getPositions(symbol) {
    const params = { category: 'linear', settleCoin: 'USDT', symbol };
    const headers = this.sign(params);
    const { data } = await this.http.get('/v5/position/list', { params, headers });
    return data.result?.list || [];
  }
}
