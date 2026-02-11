import { describe, expect, it } from 'vitest';
import { detectRegime } from '../src/bots/rangeBot/regimeDetector.js';

describe('regimeDetector', () => {
  it('classifies crab', () => expect(detectRegime([0.001, -0.001, 0.002], 0.01)).toBe('CRAB'));
  it('classifies impulse', () => expect(detectRegime([0.02, -0.03, 0.01], 0.01)).toBe('IMPULSE'));
});
