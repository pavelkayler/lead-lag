export class WsRpcClient {
  constructor(path = '/ws') {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${protocol}://${location.host}${path}`;
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'response') {
        const holder = this.pending.get(msg.id);
        if (!holder) return;
        this.pending.delete(msg.id);
        if (msg.ok) holder.resolve(msg.result);
        else holder.reject(msg.error);
      }
      if (msg.type === 'event') {
        for (const cb of this.listeners) cb(msg);
      }
    };
  }

  onEvent(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: 'request', id, method, params }));
    });
  }
}
