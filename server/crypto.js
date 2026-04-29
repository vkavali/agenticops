import crypto from 'crypto';

// AES-256-GCM secrets-at-rest helper.
// Key is a 32-byte hex string from APP_ENCRYPTION_KEY (64 hex chars).
// Ciphertext format: v1:<iv-hex>:<tag-hex>:<ct-hex>

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LEN = 12;

function getKey() {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('APP_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes). Generate one with: openssl rand -hex 32');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(ciphertext) {
  if (ciphertext == null) return null;
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith(`${VERSION}:`)) {
    // Legacy plaintext from before encryption was enabled. Return as-is so callers
    // can migrate it the next time it's written.
    return ciphertext;
  }
  const [, ivHex, tagHex, ctHex] = ciphertext.split(':');
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}
