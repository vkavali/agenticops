import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '../crypto.js';

beforeAll(() => {
  // 64-char hex (32 bytes) — fixed key so tests are reproducible.
  process.env.APP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('crypto', () => {
  it('round-trips arbitrary plaintext', () => {
    for (const sample of ['hello', '', 'with spaces and "quotes"', 'unicode 🤖', 'a'.repeat(10_000)]) {
      const ct = encrypt(sample);
      expect(isEncrypted(ct)).toBe(true);
      expect(decrypt(ct)).toBe(sample);
    }
  });

  it('produces a fresh IV per call (no nonce reuse)', () => {
    const a = encrypt('payload');
    const b = encrypt('payload');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('payload');
    expect(decrypt(b)).toBe('payload');
  });

  it('passes through legacy plaintext', () => {
    expect(decrypt('not-encrypted-yet')).toBe('not-encrypted-yet');
    expect(isEncrypted('not-encrypted-yet')).toBe(false);
  });

  it('handles null input', () => {
    expect(encrypt(null)).toBe(null);
    expect(decrypt(null)).toBe(null);
  });

  it('rejects tampered ciphertext', () => {
    const ct = encrypt('secret');
    // Flip one character of the ciphertext payload — auth tag should reject.
    const parts = ct.split(':');
    const ctHex = parts[3];
    parts[3] = (ctHex.startsWith('0') ? '1' : '0') + ctHex.slice(1);
    const tampered = parts.join(':');
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('crypto key validation', () => {
  it('throws when APP_ENCRYPTION_KEY is missing', () => {
    const saved = process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_ENCRYPTION_KEY;
    try {
      expect(() => encrypt('x')).toThrow(/APP_ENCRYPTION_KEY/);
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved;
    }
  });
});
