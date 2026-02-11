import fs from 'node:fs';
import path from 'node:path';
import { RangeConfig, RangeConfigSchema } from '../config/rangeConfig.js';

export class RangeConfigStore {
  constructor(private readonly file: string) {}
  get(): RangeConfig {
    try {
      return RangeConfigSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return RangeConfigSchema.parse({});
    }
  }
  set(next: unknown): RangeConfig {
    const parsed = RangeConfigSchema.parse(next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(parsed, null, 2));
    return parsed;
  }
}
