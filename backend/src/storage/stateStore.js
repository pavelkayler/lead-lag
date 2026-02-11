import fs from 'node:fs';

export class StateStore {
  constructor(path = './data/state.json') {
    this.path = path;
  }

  save(state) {
    fs.writeFileSync(this.path, JSON.stringify(state, null, 2));
  }
}
