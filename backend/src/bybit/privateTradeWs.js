import WebSocket from 'ws';
import crypto from 'node:crypto';

const URLS = {
  demo: 'wss://stream-demo.bybit.com/v5/trade',
  testnet: 'wss://stream-testnet.bybit.com/v5/trade',
  mainnet: 'wss://stream.bybit.com/v5/trade'
};

export class BybitPrivateTradeWs {
  constructor(env, logger) {
    this.env = env;
    this.logger = logger;
    this.ws = null;
    this.connected = false;
    this.handlers = new Set();
  }

  connect() {
    if (this.ws) return;
    this.ws = new WebSocket(URLS[this.env.BYBIT_ENV]);
    this.ws.on('open', () => {
      const expires = Date.now() + 10000;
      const signature = crypto.createHmac('sha256', this.env.BYBIT_API_SECRET).update(`GET/realtime${expires}`).digest('hex');
      this.ws.send(JSON.stringify({ op: 'auth', args: [this.env.BYBIT_API_KEY, expires, signature] }));
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 'auth' && msg.success) {
        this.connected = true;
        this.logger.info('Trade WS authenticated');
      }
      for (const h of this.handlers) h(msg);
    });
    this.ws.on('close', () => {
      this.connected = false;
      this.ws = null;
      this.logger.warn('Trade WS closed');
      setTimeout(() => this.connect(), 1000);
    });
  }

  onMessage(handler) {
    this.handlers.add(handler);
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}
