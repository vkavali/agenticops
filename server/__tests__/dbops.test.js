import { describe, it, expect } from 'vitest';
import { analyzeSql } from '../dbops.js';

describe('analyzeSql — hazard detection', () => {
  it('safe migration scores 100', () => {
    const r = analyzeSql(`
      BEGIN;
      ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free';
      COMMIT;
    `);
    expect(r.score).toBe(100);
    expect(r.warnings).toHaveLength(0);
  });

  it('flags DROP TABLE', () => {
    const r = analyzeSql('DROP TABLE users;');
    expect(r.warnings.find(w => w.code === 'destructive-drop')).toBeDefined();
    expect(r.score).toBeLessThan(60);
  });

  it('flags DELETE without WHERE', () => {
    const r = analyzeSql('DELETE FROM accounts;');
    expect(r.warnings.find(w => w.code === 'unrestricted-delete')).toBeDefined();
  });

  it('does NOT flag DELETE with WHERE', () => {
    const r = analyzeSql("DELETE FROM accounts WHERE archived=true;");
    expect(r.warnings.find(w => w.code === 'unrestricted-delete')).toBeUndefined();
  });

  it('flags ADD COLUMN NOT NULL without DEFAULT', () => {
    const r = analyzeSql('ALTER TABLE foo ADD COLUMN bar INT NOT NULL;');
    expect(r.warnings.find(w => w.code === 'add-column-not-null-no-default')).toBeDefined();
  });

  it('does NOT flag ADD COLUMN NOT NULL with DEFAULT', () => {
    const r = analyzeSql('ALTER TABLE foo ADD COLUMN bar INT NOT NULL DEFAULT 0;');
    expect(r.warnings.find(w => w.code === 'add-column-not-null-no-default')).toBeUndefined();
  });

  it('flags non-CONCURRENT CREATE INDEX', () => {
    const r = analyzeSql('CREATE INDEX idx_users_email ON users(email);');
    expect(r.warnings.find(w => w.code === 'create-index-no-concurrent')).toBeDefined();
  });

  it('does NOT flag CONCURRENT CREATE INDEX', () => {
    const r = analyzeSql('CREATE INDEX CONCURRENTLY idx_users_email ON users(email);');
    expect(r.warnings.find(w => w.code === 'create-index-no-concurrent')).toBeUndefined();
  });

  it('flags DROP COLUMN', () => {
    const r = analyzeSql('ALTER TABLE users DROP COLUMN legacy_field;');
    expect(r.warnings.find(w => w.code === 'drop-column')).toBeDefined();
  });

  it('flags ALTER COLUMN TYPE', () => {
    const r = analyzeSql('ALTER TABLE users ALTER COLUMN age TYPE BIGINT;');
    expect(r.warnings.find(w => w.code === 'alter-column-type')).toBeDefined();
  });

  it('combines multiple hazards into a low score (< 50 → admin gate)', () => {
    const r = analyzeSql(`
      DROP TABLE legacy;
      DELETE FROM users;
    `);
    expect(r.score).toBeLessThan(50);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('handles null/empty input', () => {
    expect(analyzeSql('').score).toBe(100);
    expect(analyzeSql(null).score).toBe(100);
    expect(analyzeSql(undefined).score).toBe(100);
  });
});
