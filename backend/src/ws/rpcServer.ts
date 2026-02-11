import { WebSocketServer } from 'ws';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { rangeConfigUiSchema, RangeConfigSchema } from '../config/rangeConfig.js';
import type { RpcRequest, RpcResponse } from '../types/rpc.js';

export function createHttpServer(): Server {
  const root = path.resolve(process.cwd(), '..');
  const newDist = path.join(root, 'frontend', 'dist');
  const oldDist = path.join(root, 'frontend', 'old', 'dist');

  return createServer((req, res) => {
    const url = req.url || '/';
    const isOld = url.startsWith('/old');
    const base = isOld ? oldDist : newDist;
    const rel = isOld ? url.replace(/^\/old/, '') || '/' : url;
    const target = path.join(base, rel === '/' ? 'index.html' : rel);
    const fallback = path.join(base, 'index.html');
    const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : fallback;
    if (!fs.existsSync(file)) { res.statusCode = 404; res.end('Build not found'); return; }
    res.end(fs.readFileSync(file));
  });
}

export function attachRpc(server: Server, app: any) {
  const wss = new WebSocketServer({ server });
  const subscriptions = new Map<any, Set<string>>();
  const respond = (ws: any, msg: RpcResponse) => ws.send(JSON.stringify(msg));
  const broadcast = (topic: string, payload: unknown) => {
    for (const c of wss.clients) {
      if (subscriptions.get(c)?.has(topic)) c.send(JSON.stringify({ type: 'event', topic, payload }));
    }
  };
  app.feed.on('tick', (t: any) => broadcast('prices', t));

  wss.on('connection', (ws) => {
    subscriptions.set(ws, new Set());
    ws.on('message', async (raw) => {
      const req: RpcRequest = JSON.parse(String(raw));
      try {
        switch (req.type) {
          case 'subscribe': subscriptions.get(ws)?.add((req.payload as any).topic); return respond(ws, { type: 'response', id: req.id, ok: true, payload: true });
          case 'unsubscribe': subscriptions.get(ws)?.delete((req.payload as any).topic); return respond(ws, { type: 'response', id: req.id, ok: true, payload: true });
          case 'startFeed': app.feed.start(); return respond(ws, { type: 'response', id: req.id, ok: true, payload: { started: true } });
          case 'stopFeed': app.feed.stop(); return respond(ws, { type: 'response', id: req.id, ok: true, payload: { stopped: true } });
          case 'setSymbols': app.feed.setSymbols((req.payload as any).symbols || []); return respond(ws, { type: 'response', id: req.id, ok: true, payload: { ok: true } });
          case 'getRangeConfigSchema': return respond(ws, { type: 'response', id: req.id, ok: true, payload: { fields: rangeConfigUiSchema } });
          case 'getRangeConfig': return respond(ws, { type: 'response', id: req.id, ok: true, payload: app.configStore.get() });
          case 'setRangeConfig': return respond(ws, { type: 'response', id: req.id, ok: true, payload: app.configStore.set(RangeConfigSchema.parse(req.payload)) });
          case 'paperStart': case 'botStart': app.bot.start(); return respond(ws, { type: 'response', id: req.id, ok: true, payload: app.bot.state() });
          case 'paperStop': case 'botStop': app.bot.stop(); return respond(ws, { type: 'response', id: req.id, ok: true, payload: app.bot.state() });
          case 'paperState': return respond(ws, { type: 'response', id: req.id, ok: true, payload: app.bot.state() });
          case 'getMetrics': return respond(ws, { type: 'response', id: req.id, ok: true, payload: { env: { tradeTransport: process.env.BYBIT_REAL_TRANSPORT || 'ws' } } });
          default: return respond(ws, { type: 'response', id: req.id, ok: true, payload: { notImplemented: req.type } });
        }
      } catch (e: any) {
        respond(ws, { type: 'response', id: req.id, ok: false, error: String(e?.message || e) });
      }
    });
    ws.on('close', () => subscriptions.delete(ws));
  });
}
