import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

export function createLogger(env) {
  fs.mkdirSync(env.LOG_DIR, { recursive: true });
  const destination = pino.destination(path.join(env.LOG_DIR, 'app.log'));
  return pino(
    {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.multistream([
      { stream: process.stdout },
      { stream: destination }
    ])
  );
}
