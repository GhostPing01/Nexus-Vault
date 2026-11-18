import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
  isValidEmail,
  isValidPassword
} from '../server/authService.js';
import { initDb, dbRun, dbGet } from '../server/db.js';
import { resolveUserContext } from '../server/chatService.js';

describe('Authentication & Session Security Tests', async () => {
  before(async () => {
    await initDb();
  });

  it('validates email addresses correctly', () => {
    assert.equal(isValidEmail('user@nexus.io'), true);
    assert.equal(isValidEmail('invalid-email'), false);
    assert.equal(isValidEmail(''), false);
    assert.equal(isValidEmail(null), false);
  });

  it('validates minimum password strength', () => {
    assert.equal(isValidPassword('strongPass123'), true);
    assert.equal(isValidPassword('12345'), false);
    assert.equal(isValidPassword(''), false);
    assert.equal(isValidPassword(null), false);
  });

  it('hashes passwords using scrypt with unique salts', async () => {
    const raw = 'SuperSecretVaultPass#2026';
    const hash1 = await hashPassword(raw);
    const hash2 = await hashPassword(raw);

    assert.notEqual(hash1, hash2, 'Subsequent hashes must have unique cryptographic salts');
    assert.match(hash1, /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'Hash format must be salt:derivedKey');

    const isMatch1 = await verifyPassword(raw, hash1);
    const isMatch2 = await verifyPassword(raw, hash2);
    const isWrong = await verifyPassword('WrongPassword', hash1);

    assert.equal(isMatch1, true);
    assert.equal(isMatch2, true);
    assert.equal(isWrong, false);
  });

  it('creates cryptographically random session tokens and resolves active session user', async () => {
    const testUserId = 'test_usr_' + Date.now();
    const testEmail = `test_${Date.now()}@example.com`;
    const now = new Date().toISOString();

    await dbRun(
      `INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [testUserId, testEmail, 'dummy_hash', 'Test User', now, now]
    );

    const session = await createSession(testUserId);
    assert.ok(session.token);
    assert.equal(session.token.length, 64, 'Session token must be 32 bytes hex (64 chars)');

    const user = await getSessionUser(session.token);
    assert.ok(user);
    assert.equal(user.id, testUserId);
    assert.equal(user.email, testEmail);

    // Delete session
    await deleteSession(session.token);
    const expiredUser = await getSessionUser(session.token);
    assert.equal(expiredUser, null, 'Deleted session must not resolve to any user');
  });

  it('prevents header-based x-user-id spoofing in production mode', () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_DEV_HEADER_AUTH;

      const fakeReq = {
        headers: {
          'x-user-id': 'victim_user_id',
        },
      };

      const resolved = resolveUserContext(fakeReq);
      assert.notEqual(resolved.userId, 'victim_user_id', 'Spoofed header must be ignored');
      assert.equal(resolved.userId, 'default_user', 'Unauthenticated request must map to guest demo user');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
