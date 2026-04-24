import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt, setDbInstance } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { hashToken, signToken } from '../src/middleware/auth.js';
import { buildServer } from '../src/server.js';
import { DownloadService, type TrackMeta } from '../src/services/download.js';

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

const seedTrack = (id: number): void => {
  db.prepare(
    'INSERT INTO tracks (id, title, artist_id, artist_name, album_title, preview_url, artwork_url, duration_ms, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    `Track ${id}`,
    id * 10,
    `Artist ${id * 10}`,
    `Album ${id}`,
    `https://preview.example/${id}.mp3`,
    `https://art.example/${id}.jpg`,
    210000,
    Date.now(),
  );
};

const likeCrate = (userId: number, trackId: number): void => {
  db.prepare('INSERT INTO crates (user_id, track_id, liked_at) VALUES (?, ?, ?)').run(
    userId,
    trackId,
    Date.now(),
  );
};

const sampleMeta: TrackMeta = {
  id: 1,
  title: 'Sunrise',
  artistName: 'DJ Sol',
  albumTitle: 'Morning Set',
  bpm: 128,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-download-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
  seedTrack(1);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// DownloadService unit tests
// ---------------------------------------------------------------------------

describe('DownloadService', () => {
  it('inserts a queued row and calls the runner, ending up ready', async () => {
    const fakePath = '/tmp/test/DJ Sol - Sunrise.mp3';
    const runner = async (_meta: TrackMeta): Promise<string> => fakePath;

    const service = new DownloadService(db, runner);

    // Verify the row is upserted to queued synchronously before the job settles
    let capturedStatus: string | undefined;
    const wrappedRunner: typeof runner = async (meta) => {
      capturedStatus = (
        db
          .prepare('SELECT status FROM downloads WHERE track_id = ?')
          .get(meta.id) as { status: string } | undefined
      )?.status;
      return runner(meta);
    };
    const wrappedService = new DownloadService(db, wrappedRunner);
    const jobPromise = await wrappedService.startDownload(sampleMeta);
    await jobPromise;

    // The runner saw 'downloading' (transition from queued -> downloading inside runJob)
    expect(capturedStatus).toBe('downloading');

    const row = db
      .prepare('SELECT status, file_path FROM downloads WHERE track_id = ?')
      .get(sampleMeta.id) as { status: string; file_path: string } | undefined;
    expect(row?.status).toBe('ready');
    expect(row?.file_path).toBe(fakePath);
  });

  it('re-queues a previously failed download and ends up ready', async () => {
    // Pre-insert a failed row
    db.prepare(
      `INSERT INTO downloads (track_id, status, error, started_at) VALUES (?, 'failed', 'oops', ?)`,
    ).run(sampleMeta.id, Date.now() - 5000);

    const fakePath = '/tmp/test/DJ Sol - Sunrise.mp3';
    const runner = async (_meta: TrackMeta): Promise<string> => fakePath;

    const service = new DownloadService(db, runner);
    const jobPromise = await service.startDownload(sampleMeta);
    await jobPromise;

    const row = db
      .prepare('SELECT status, file_path, error FROM downloads WHERE track_id = ?')
      .get(sampleMeta.id) as { status: string; file_path: string; error: string | null } | undefined;
    expect(row?.status).toBe('ready');
    expect(row?.file_path).toBe(fakePath);
    expect(row?.error).toBeNull();
  });

  it('sets status to failed when the runner throws', async () => {
    const runner = async (_meta: TrackMeta): Promise<string> => {
      throw new Error('yt-dlp not found');
    };

    const service = new DownloadService(db, runner);
    const jobPromise = await service.startDownload(sampleMeta);
    await jobPromise;

    const row = db
      .prepare('SELECT status, error FROM downloads WHERE track_id = ?')
      .get(sampleMeta.id) as { status: string; error: string } | undefined;
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('yt-dlp not found');
  });
});

// ---------------------------------------------------------------------------
// POST /download route tests
// ---------------------------------------------------------------------------

describe('POST /download', () => {
  it('returns 401 without a token', async () => {
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/download',
      payload: { track_id: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown track', async () => {
    const { token } = seedUser();
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/download',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 9999 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'track not found' });
  });

  it('returns 403 if the track is not in the user crate', async () => {
    const { token } = seedUser();
    // track 1 is seeded but NOT in crate
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/download',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'track not in your crate' });
  });

  it('returns 202 with status queued for a fresh download', async () => {
    const { userId, token } = seedUser();
    likeCrate(userId, 1);

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/download',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'queued' });
  });

  it('returns 200 with file_path if the download is already ready', async () => {
    const { userId, token } = seedUser();
    likeCrate(userId, 1);
    db.prepare(
      `INSERT INTO downloads (track_id, status, file_path, started_at, finished_at)
       VALUES (?, 'ready', ?, ?, ?)`,
    ).run(1, '/music/DJ Sol - Sunrise.mp3', Date.now() - 10000, Date.now() - 1000);

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/download',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ready',
      file_path: '/music/DJ Sol - Sunrise.mp3',
    });
  });

  it('returns 202 with current status if download is already in progress', async () => {
    const { userId, token } = seedUser();
    likeCrate(userId, 1);
    db.prepare(
      `INSERT INTO downloads (track_id, status, started_at) VALUES (?, 'downloading', ?)`,
    ).run(1, Date.now() - 5000);

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/download',
      headers: { authorization: `Bearer ${token}` },
      payload: { track_id: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'downloading' });
  });
});
