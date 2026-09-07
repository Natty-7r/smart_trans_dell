'use strict';

// Isolated DB per test file (must be set before requiring app modules).
const path = require('path');
process.env.TT_DATABASE_FILE = path.join(require('os').tmpdir(), `tt-auth-${process.pid}.db`);
process.env.OLLAMA_HOST = 'http://127.0.0.1:1'; // force offline (no embeddings/LLM in tests)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { hashPassword, verifyPassword, createSession, verifyToken, destroySession } = require('../src/auth');
const { init } = require('../src/database');
const User = require('../src/models/User');

test.before(() => { init(); });
test.after(() => { try { fs.unlinkSync(process.env.TT_DATABASE_FILE); } catch (_) {} });

test('password hashing never stores plaintext and round-trips', () => {
  const stored = hashPassword('S3cret!!');
  assert.ok(stored.startsWith('scrypt$'), 'uses scrypt scheme');
  assert.ok(!stored.includes('S3cret!!'), 'no plaintext in hash');
  assert.strictEqual(verifyPassword('S3cret!!', stored), true);
  assert.strictEqual(verifyPassword('wrong', stored), false);
});

test('password policy rejects too-short passwords', () => {
  assert.throws(() => hashPassword('123'), /at least 6/);
});

test('session token verifies to the live user and can be destroyed', () => {
  const u = User.create({ username: 'sess_test', password: 'Password@123', role: 'field_technician', full_name: 'Sess Test' });
  const { token } = createSession(u.user_id);
  const resolved = verifyToken(token);
  assert.ok(resolved, 'token resolves');
  assert.strictEqual(resolved.user_id, u.user_id);
  destroySession(token);
  assert.strictEqual(verifyToken(token), null, 'destroyed token no longer valid');
});

test('inactive users cannot authenticate via token', () => {
  const u = User.create({ username: 'inactive_test', password: 'Password@123', role: 'field_technician' });
  const { token } = createSession(u.user_id);
  User.deactivate(u.user_id);
  assert.strictEqual(verifyToken(token), null, 'deactivation revokes access');
});
