import WebSocket from 'ws';

const URLS = {
  demo: 'wss://stream-demo.bybit.com/v5/public/linear',
  testnet: 'wss://stream-testnet.bybit.com/v5/public/linear',
  mainnet: 'wss://stream.bybit.com/v5/public/linear'
};

export class BybitPublicWs {
  constructor(env, logger) {
    this.env = env;
    this.logger = logger;
    this.ws = null;
    this.subscriptions = new Set();
    this.handlers = new Set();
  }

  connect() {
    if (this.ws) return;
    this.ws = new WebSocket(URLS[this.env.BYBIT_ENV]);
    this.ws.on('open', () => {
      this.logger.info('Public WS connected');
      if (this.subscriptions.size) this.subscribe([...this.subscriptions]);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      for (const handler of this.handlers) handler(msg);
    });
    this.ws.on('close', () => {
      this.logger.warn('Public WS closed, reconnecting...');
      this.ws = null;
      setTimeout(() => this.connect(), 1000);
    });
  }

  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribe(topics) {
    topics.forEach((t) => this.subscriptions.add(t));
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'subscribe', args: topics }));
    }
  }

  unsubscribe(topics) {
    topics.forEach((t) => this.subscriptions.delete(t));
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'unsubscribe', args: topics }));
    }
  }
}
