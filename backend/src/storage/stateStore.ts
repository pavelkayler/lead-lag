import fs from 'node:fs';
import path from 'node:path';

type BotState = { running: boolean; position?: unknown; updatedAt: number };

export class BotStateStore {
  constructor(private readonly file: string) {}
  load(): BotState {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { running: false, updatedAt: Date.now() }; }
  }
  save(state: BotState) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2));
  }
}
