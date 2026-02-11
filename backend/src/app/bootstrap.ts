import fs from 'node:fs';
import path from 'node:path';
import { RangeConfigStore } from '../storage/configStore.js';
import { BotStateStore } from '../storage/stateStore.js';
import { createRangeBot } from '../bots/rangeBot/rangeBot.js';
import { BybitPublicFeed } from '../feed/bybitPublicFeed.js';
import { createExecutionGateway } from '../trading/executionGateway.js';

function loadDotEnv(cwd = process.cwd()) {
  const p = path.join(cwd, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export function bootstrap() {
  loadDotEnv();
  const configStore = new RangeConfigStore('results/range-config.json');
  const stateStore = new BotStateStore('results/range-bot-state.json');
  const gateway = createExecutionGateway();
  const feed = new BybitPublicFeed();
  const bot = createRangeBot({ configStore, stateStore, gateway, feed });
  return { configStore, stateStore, gateway, feed, bot };
}
