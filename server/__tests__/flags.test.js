import { describe, it, expect } from 'vitest';
import { hashBucket, matchCondition, matchAll } from '../flags.js';

describe('hashBucket', () => {
  it('returns 0..99', () => {
    for (let i = 0; i < 100; i++) {
      const b = hashBucket(`subject-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is stable per input (same key → same bucket)', () => {
    expect(hashBucket('flag-x:user-42')).toBe(hashBucket('flag-x:user-42'));
    expect(hashBucket('flag-y:user-42')).toBe(hashBucket('flag-y:user-42'));
  });

  it('differs across inputs (no degeneracy)', () => {
    const buckets = new Set();
    for (let i = 0; i < 50; i++) buckets.add(hashBucket(`k-${i}`));
    // Birthday paradox: 50 samples into 100 buckets gives ~39.4 distinct.
    // Allow some variance but a degenerate hash (all same bucket) would fail.
    expect(buckets.size).toBeGreaterThan(30);
  });

  it('produces a roughly uniform distribution at 1k samples', () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 1000; i++) {
      counts[Math.floor(hashBucket(`u-${i}`) / 10)]++;
    }
    // No bucket should hold > 25% or < 4% of mass — anything outside that
    // means the hash is biased.
    for (const c of counts) {
      expect(c).toBeGreaterThan(40);
      expect(c).toBeLessThan(250);
    }
  });
});

describe('matchCondition', () => {
  const ctx = { plan: 'enterprise', region: 'us-east', age: 7 };

  it('equals / not_equals', () => {
    expect(matchCondition({ attr: 'plan', op: 'equals', value: 'enterprise' }, ctx)).toBe(true);
    expect(matchCondition({ attr: 'plan', op: 'equals', value: 'free' }, ctx)).toBe(false);
    expect(matchCondition({ attr: 'plan', op: 'not_equals', value: 'free' }, ctx)).toBe(true);
  });

  it('in / not_in', () => {
    expect(matchCondition({ attr: 'region', op: 'in', value: ['us-east', 'us-west'] }, ctx)).toBe(true);
    expect(matchCondition({ attr: 'region', op: 'not_in', value: ['eu-west'] }, ctx)).toBe(true);
  });

  it('numerical comparators', () => {
    expect(matchCondition({ attr: 'age', op: 'gt', value: 5 }, ctx)).toBe(true);
    expect(matchCondition({ attr: 'age', op: 'lt', value: 5 }, ctx)).toBe(false);
    expect(matchCondition({ attr: 'age', op: 'gte', value: 7 }, ctx)).toBe(true);
    expect(matchCondition({ attr: 'age', op: 'lte', value: 7 }, ctx)).toBe(true);
  });

  it('contains', () => {
    expect(matchCondition({ attr: 'region', op: 'contains', value: 'east' }, ctx)).toBe(true);
    expect(matchCondition({ attr: 'region', op: 'contains', value: 'west' }, ctx)).toBe(false);
  });

  it('present', () => {
    expect(matchCondition({ attr: 'plan', op: 'present' }, ctx)).toBe(true);
    expect(matchCondition({ attr: 'missing', op: 'present' }, ctx)).toBe(false);
  });

  it('unknown op returns false (no crash)', () => {
    expect(matchCondition({ attr: 'plan', op: 'magic', value: 'enterprise' }, ctx)).toBe(false);
  });
});

describe('matchAll', () => {
  const ctx = { plan: 'enterprise', region: 'us-east' };

  it('empty conditions match everything', () => {
    expect(matchAll([], ctx)).toBe(true);
    expect(matchAll(undefined, ctx)).toBe(true);
  });

  it('all conditions must match', () => {
    expect(matchAll([
      { attr: 'plan', op: 'equals', value: 'enterprise' },
      { attr: 'region', op: 'equals', value: 'us-east' },
    ], ctx)).toBe(true);

    expect(matchAll([
      { attr: 'plan', op: 'equals', value: 'enterprise' },
      { attr: 'region', op: 'equals', value: 'eu-west' },
    ], ctx)).toBe(false);
  });
});
