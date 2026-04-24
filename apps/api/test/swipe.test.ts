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

const seedUser = (displayName = 'Gregor'): { userId: number; token: string } => {
  const now = Date.now();
  const result = db
    .prepare('INSERT INTO users (display_name, is_admin, created_at) VALUES (?, ?, ?)')
    .run(displayName, 0, now);
  const userId = Number(result.lastInsertRowid);
  const token = signToken({ userId, displayName, isAdmin: false });
  db.prepare('INSERT INTO tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)').run(
    userId,
    hashToken(token),
    now,
  );
  return { userId, token };
};

const seedTrack = (id = 1): void => {
  db.prepare(
    'INSERT INTO tracks (id, title, artist_id, artist_name, preview_url, artwork_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'Test Track', 10, 'Artist Name', 'http://p.mp3', 'http://art.jpg', Date.now());
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-swipe-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /swipe', () => {
  it('returns 204 on a valid pass swipe and inserts swipe row but no crates row', async () => {
    const { userId, token } = seedUser();
    seedTrack(1);

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/swipe',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1, direction: 'pass', listened_ms: 5000 },
    });
    await app.close();

    expect(res.statusCode).toBe(204);

    const swipe = db
      .prepare('SELECT * FROM swipes WHERE user_id = ? AND track_id = ?')
      .get(userId, 1) as { direction: string; listened_ms: number } | undefined;
    expect(swipe).toBeDefined();
    expect(swipe!.direction).toBe('pass');
    expect(swipe!.listened_ms).toBe(5000);

    const crate = db
      .prepare('SELECT * FROM crates WHERE user_id = ? AND track_id = ?')
      .get(userId, 1);
    expect(crate).toBeUndefined();
  });

  it('returns 204 on a valid like swipe and inserts both swipe and crates rows', async () => {
    const { userId, token } = seedUser();
    seedTrack(1);

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/swipe',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1, direction: 'like', listened_ms: 20000 },
    });
    await app.close();

    expect(res.statusCode).toBe(204);

    const swipe = db
      .prepare('SELECT * FROM swipes WHERE user_id = ? AND track_id = ?')
      .get(userId, 1) as { direction: string; listened_ms: number } | undefined;
    expect(swipe).toBeDefined();
    expect(swipe!.direction).toBe('like');
    expect(swipe!.listened_ms).toBe(20000);

    const crate = db
      .prepare('SELECT * FROM crates WHERE user_id = ? AND track_id = ?')
      .get(userId, 1);
    expect(crate).toBeDefined();
  });

  it('is idempotent — second swipe on same track returns 204 without error and only 1 swipe row exists', async () => {
    const { userId, token } = seedUser();
    seedTrack(1);

    const app = buildServer();

    const res1 = await app.inject({
      method: 'POST',
      url: '/swipe',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1, direction: 'like', listened_ms: 10000 },
    });
    expect(res1.statusCode).toBe(204);

    const res2 = await app.inject({
      method: 'POST',
      url: '/swipe',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1, direction: 'pass', listened_ms: 500 },
    });
    expect(res2.statusCode).toBe(204);

    await app.close();

    const count = db
      .prepare('SELECT COUNT(*) as c FROM swipes WHERE user_id = ? AND track_id = ?')
      .get(userId, 1) as { c: number };
    expect(count.c).toBe(1);
  });

  it('returns 404 for unknown track_id', async () => {
    const { token } = seedUser();
    // No track seeded

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/swipe',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 999, direction: 'like', listened_ms: 0 },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'track not found' });
  });

  it('returns 400 for invalid direction', async () => {
    const { token } = seedUser();
    seedTrack(1);

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/swipe',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1, direction: 'neither', listened_ms: 0 },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/swipe',
      payload: { track_id: 1, direction: 'like', listened_ms: 0 },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});
