import fs from 'node:fs';
import path from 'node:path';
import { schemaDefaults, validateConfig } from './configSchema.js';

export class ConfigStore {
  constructor(filePath = './data/config.json') {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(schemaDefaults(), null, 2));
    }
    this.config = this.load();
  }

  load() {
    const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    return validateConfig(raw);
  }

  get() {
    return this.config;
  }

  set(partial) {
    this.config = validateConfig({ ...this.config, ...partial });
    fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2));
    return this.config;
  }
}
