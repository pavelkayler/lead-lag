import express from 'express';
import path from 'node:path';

export function createHttpServer({ env, bot }) {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/version', (_req, res) => res.json({ version: '1.0.0', mode: env.TRADING_MODE }));

  if (env.NODE_ENV === 'production') {
    const dist = path.resolve(process.cwd(), '../frontend/dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return app;
}
