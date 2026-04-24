import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt, setDbInstance } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { hashToken, signToken } from '../src/middleware/auth.js';
import { buildServer } from '../src/server.js';

let dir: string;
let db: DB;

const seedUser = (displayName: string, isAdmin = false): { userId: number; token: string } => {
  const now = Date.now();
  const result = db
    .prepare('INSERT INTO users (display_name, is_admin, created_at) VALUES (?, ?, ?)')
    .run(displayName, isAdmin ? 1 : 0, now);
  const userId = Number(result.lastInsertRowid);
  const token = signToken({ userId, displayName, isAdmin });
  db.prepare('INSERT INTO tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)').run(
    userId,
    hashToken(token),
    now,
  );
  return { userId, token };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-auth-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth middleware', () => {
  it('allows /health without a token', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects /whoami with no Authorization header', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'AUTH_MISSING' });
    await app.close();
  });

  it('rejects /whoami with a malformed token', async () => {
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'AUTH_INVALID' });
    await app.close();
  });

  it('rejects a valid JWT whose hash is not in the tokens table (revoked)', async () => {
    const { token } = seedUser('Alice');
    db.prepare('DELETE FROM tokens').run();
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts a valid token and returns the user on /whoami', async () => {
    const { userId, token } = seedUser('Alice', true);
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: userId, displayName: 'Alice', isAdmin: true });
    await app.close();
  });

  it('updates tokens.last_used_at on successful auth', async () => {
    const { token } = seedUser('Bob');
    const before = db
      .prepare('SELECT last_used_at FROM tokens LIMIT 1')
      .get() as { last_used_at: number | null };
    expect(before.last_used_at).toBeNull();
    const app = buildServer();
    await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${token}` },
    });
    const after = db
      .prepare('SELECT last_used_at FROM tokens LIMIT 1')
      .get() as { last_used_at: number | null };
    expect(after.last_used_at).not.toBeNull();
    await app.close();
  });
});
