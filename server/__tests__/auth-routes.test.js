import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { roleForGithubUser } from '../routes/auth.js';

describe('roleForGithubUser', () => {
  // Keep the env clean across tests so one doesn't bleed into another.
  const originalEnv = { ...process.env };
  afterEach(() => {
    delete process.env.GITHUB_ADMIN_USERS;
    delete process.env.GITHUB_OPERATOR_USERS;
    delete process.env.GITHUB_ALLOWED_USERS;
    Object.assign(process.env, originalEnv);
  });

  it('defaults to viewer when no env vars set', () => {
    expect(roleForGithubUser('alice')).toBe('viewer');
  });

  it('promotes admins by env list', () => {
    process.env.GITHUB_ADMIN_USERS = 'alice,bob';
    expect(roleForGithubUser('alice')).toBe('admin');
    expect(roleForGithubUser('bob')).toBe('admin');
    expect(roleForGithubUser('carol')).toBe('viewer');
  });

  it('promotes operators by env list', () => {
    process.env.GITHUB_OPERATOR_USERS = 'carol';
    expect(roleForGithubUser('carol')).toBe('operator');
    expect(roleForGithubUser('alice')).toBe('viewer');
  });

  it('admin list takes precedence over operator', () => {
    process.env.GITHUB_ADMIN_USERS = 'alice';
    process.env.GITHUB_OPERATOR_USERS = 'alice'; // also in operator
    expect(roleForGithubUser('alice')).toBe('admin');
  });

  it('handles whitespace + empty entries in env lists', () => {
    process.env.GITHUB_ADMIN_USERS = ' alice , , bob ';
    expect(roleForGithubUser('alice')).toBe('admin');
    expect(roleForGithubUser('bob')).toBe('admin');
  });

  it('GITHUB_ALLOWED_USERS gates everyone — non-listed users get null (denied)', () => {
    process.env.GITHUB_ALLOWED_USERS = 'alice,bob';
    process.env.GITHUB_ADMIN_USERS = 'alice';
    expect(roleForGithubUser('alice')).toBe('admin');
    expect(roleForGithubUser('bob')).toBe('viewer');   // allowed but not admin
    expect(roleForGithubUser('carol')).toBe(null);     // explicitly denied
  });

  it('empty GITHUB_ALLOWED_USERS = no gate', () => {
    process.env.GITHUB_ALLOWED_USERS = '';
    expect(roleForGithubUser('anyone')).toBe('viewer');
  });
});
