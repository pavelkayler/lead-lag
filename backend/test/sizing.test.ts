import { describe, expect, it } from 'vitest';
import { calcOrderQty, roundToStep } from '../src/trading/executionGateway.js';

describe('order sizing', () => {
  it('rounding by step', () => expect(roundToStep(1.23456, 0.01)).toBe(1.23));
  it('risk-based qty', () => expect(calcOrderQty(1000, 1, 100, 99, 0.001, 0.001)).toBe(10));
});
