import { describe, it, expect } from 'vitest';
import { mean, variance, welchT } from '../canary.js';

describe('canary statistics', () => {
  it('mean of empty array is 0', () => {
    expect(mean([])).toBe(0);
  });
  it('variance of n<2 is 0', () => {
    expect(variance([])).toBe(0);
    expect(variance([5])).toBe(0);
  });
  it('mean + variance match known values', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    expect(variance(xs)).toBeCloseTo(4.571, 2); // sample variance, divided by n-1
  });

  it("welch's t-statistic distinguishes clearly different samples", () => {
    // Identical means → t≈0
    const a = [100, 102, 99, 101, 100, 100, 103, 99, 101, 100];
    const b = [100, 99, 101, 100, 100, 102, 100, 99, 101, 100];
    const r1 = welchT(a, b);
    expect(Math.abs(r1.t)).toBeLessThan(2);

    // Canary 50% slower → strong negative t (baseline mean < canary mean)
    const baseline = [100, 102, 99, 101, 100, 100, 103, 99, 101, 100];
    const canary   = [150, 152, 149, 151, 150, 150, 153, 149, 151, 150];
    const r2 = welchT(baseline, canary);
    expect(r2.t).toBeLessThan(-2);
  });

  it('welchT returns 0 for tiny samples (df undefined)', () => {
    expect(welchT([1], [2]).t).toBe(0);
    expect(welchT([], []).t).toBe(0);
  });

  it('welchT returns 0 t when both samples have zero variance and equal means', () => {
    const r = welchT([5, 5, 5], [5, 5, 5]);
    expect(r.t).toBe(0);
  });
});
