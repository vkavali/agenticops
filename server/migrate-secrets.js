import { query, execute } from './db.js';
import { encrypt, isEncrypted } from './crypto.js';

// One-shot migration: encrypt any pre-existing plaintext secrets in place.
// Idempotent — rows already in the v1: envelope are left alone.
export async function migrateSecretsAtRest() {
  if (!process.env.APP_ENCRYPTION_KEY) {
    console.warn('⚠ APP_ENCRYPTION_KEY not set — skipping secrets migration. Existing secrets remain plaintext.');
    return;
  }

  let count = 0;

  const ghRows = await query('SELECT id, access_token FROM github_connections');
  for (const r of ghRows) {
    if (r.access_token && !isEncrypted(r.access_token)) {
      await execute('UPDATE github_connections SET access_token=$1 WHERE id=$2', [encrypt(r.access_token), r.id]);
      count++;
    }
  }

  const repoRows = await query('SELECT id, webhook_secret FROM connected_repos');
  for (const r of repoRows) {
    if (r.webhook_secret && !isEncrypted(r.webhook_secret)) {
      await execute('UPDATE connected_repos SET webhook_secret=$1 WHERE id=$2', [encrypt(r.webhook_secret), r.id]);
      count++;
    }
  }

  // cloud_connectors.credentials is JSONB — wrap in {enc: ...} envelope if not already.
  const ccRows = await query('SELECT id, credentials FROM cloud_connectors');
  for (const r of ccRows) {
    if (!r.credentials) continue;
    if (r.credentials.enc && isEncrypted(r.credentials.enc)) continue;
    const wrapped = JSON.stringify({ enc: encrypt(JSON.stringify(r.credentials)) });
    await execute('UPDATE cloud_connectors SET credentials=$1 WHERE id=$2', [wrapped, r.id]);
    count++;
  }

  if (count > 0) {
    console.log(`✓ Migrated ${count} plaintext secret(s) to encrypted-at-rest`);
  }
}
