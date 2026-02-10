export class WsHub {
  constructor({ maxBuffered = 256 * 1024, logger = null } = {}) {
    this.clients = new Set();
    this.subs = new WeakMap();
    this.maxBuffered = maxBuffered;
    this.logger = logger;

    this.stats = { sent: 0, dropped_backpressure: 0, clients: 0 };
  }

  add(ws) {
    this.clients.add(ws);
    this.subs.set(ws, new Set());
    this.stats.clients = this.clients.size;
    ws.on("close", () => this.remove(ws));
  }

  remove(ws) {
    this.clients.delete(ws);
    this.subs.delete(ws);
    this.stats.clients = this.clients.size;
  }

  subscribe(ws, topic) {
    const s = this.subs.get(ws);
    if (s && topic) s.add(topic);
  }

  unsubscribe(ws, topic) {
    const s = this.subs.get(ws);
    if (s && topic) s.delete(topic);
  }

  broadcast(topic, payload) {
    const msg = JSON.stringify({ type: "event", topic, payload });
    for (const ws of this.clients) {
      if (ws.readyState !== 1) continue;
      const s = this.subs.get(ws);
      if (!s || !s.has(topic)) continue;
      if (ws.bufferedAmount > this.maxBuffered) {
        this.stats.dropped_backpressure++;
        continue;
      }
      ws.send(msg);
      this.stats.sent++;
    }
  }

  getStats() {
    return { ...this.stats };
  }
}
