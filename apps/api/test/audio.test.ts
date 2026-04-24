import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt, setDbInstance } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { hashToken, signToken } from '../src/middleware/auth.js';
import { buildServer } from '../src/server.js';

let dir: string;
let db: DB;

const seedUser = (displayName = 'DJ Test'): { userId: number; token: string } => {
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

const seedTrack = (id: number, artistName = `Artist ${id}`, title = `Track ${id}`): void => {
  db.prepare(
    `INSERT INTO tracks (id, title, artist_id, artist_name, album_title, preview_url, artwork_url, duration_ms, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    title,
    id * 10,
    artistName,
    `Album ${id}`,
    `https://preview.example/${id}.mp3`,
    `https://art.example/${id}.jpg`,
    210000,
    Date.now(),
  );
};

const seedDownload = (
  trackId: number,
  status: string,
  filePath: string | null = null,
): void => {
  db.prepare(
    `INSERT INTO downloads (track_id, status, file_path, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(trackId, status, filePath, Date.now() - 5000, status === 'ready' ? Date.now() - 1000 : null);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-audio-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /tracks/:id/audio', () => {
  it('returns 401 without a token', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/tracks/1/audio' });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when track has no download row', async () => {
    const { token } = seedUser();
    seedTrack(1);

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/tracks/1/audio',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not downloaded' });
  });

  it('returns 404 when download status is queued (not ready)', async () => {
    const { token } = seedUser();
    seedTrack(1);
    seedDownload(1, 'queued');

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/tracks/1/audio',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not downloaded' });
  });

  it('returns 404 when download status is failed (not ready)', async () => {
    const { token } = seedUser();
    seedTrack(1);
    seedDownload(1, 'failed');

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/tracks/1/audio',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not downloaded' });
  });

  it('returns 404 when file_path is set but file is missing from disk', async () => {
    const { token } = seedUser();
    seedTrack(1, 'DJ Sol', 'Sunrise');
    seedDownload(1, 'ready', '/nonexistent/path/DJ Sol - Sunrise.mp3');

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/tracks/1/audio',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'file not found' });
  });

  it('streams the file with correct headers when download is ready and file exists', async () => {
    const { token } = seedUser();
    seedTrack(1, 'DJ Sol', 'Sunrise');

    // Create a real (minimal) temp file
    const filePath = join(dir, 'DJ Sol - Sunrise.mp3');
    writeFileSync(filePath, Buffer.from('fake-mp3-bytes'));

    seedDownload(1, 'ready', filePath);

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/tracks/1/audio',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('DJ Sol');
    expect(res.headers['content-disposition']).toContain('Sunrise');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });
});
