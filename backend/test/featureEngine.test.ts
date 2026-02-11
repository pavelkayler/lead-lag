import { describe, expect, it } from 'vitest';
import { liquidationSpike, oiDelta, volumeZScore } from '../src/bots/rangeBot/featureEngine.js';

describe('featureEngine', () => {
  it('detects liquidation spike', () => expect(liquidationSpike([10, 11, 9, 10, 45])).toBe(true));
  it('oi delta works', () => expect(oiDelta(120, 100)).toBeCloseTo(0.2));
  it('volume z positive on burst', () => expect(volumeZScore([100, 101, 99, 100, 140])).toBeGreaterThan(1.5));
});
