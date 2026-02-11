import { describe, expect, it } from 'vitest';
import { supportResistance } from '../src/bots/rangeBot/rangeModel.js';

describe('rangeModel', () => {
  it('builds S/R quantiles', () => {
    const r = supportResistance([1,2,3,4,5,6,7,8,9,10]);
    expect(r.support).toBe(3);
    expect(r.resistance).toBe(9);
  });
});
