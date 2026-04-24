import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt, setDbInstance } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { hashToken, signToken } from '../src/middleware/auth.js';
import { buildServer } from '../src/server.js';
import { downloadEvents } from '../src/events.js';
import { DownloadService, type TrackMeta } from '../src/services/download.js';

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-events-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);

  // Seed a track so downloads can reference it
  db.prepare(
    `INSERT INTO tracks (id, title, artist_id, artist_name, album_title, preview_url, artwork_url, duration_ms, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(42, 'Sunrise', 420, 'DJ Sol', 'Morning Set', 'https://p.example/42.mp3', 'https://a.example/42.jpg', 210000, Date.now());
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// SSE route auth
// ---------------------------------------------------------------------------

describe('GET /events', () => {
  it('returns 401 without a token', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/events' });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// downloadEvents EventEmitter — unit tests for correct emission
// ---------------------------------------------------------------------------

describe('downloadEvents emission', () => {
  it('emits download_ready with the correct trackId after a successful job', async () => {
    const meta: TrackMeta = { id: 42, title: 'Sunrise', artistName: 'DJ Sol', albumTitle: 'Morning Set', bpm: 128 };
    const fakePath = join(dir, 'DJ Sol - Sunrise.mp3');

    const runner = async (_m: TrackMeta): Promise<string> => fakePath;
    const service = new DownloadService(db, runner);

    const received: Array<{ trackId: number }> = [];
    const listener = (payload: { trackId: number }) => {
      received.push(payload);
    };

    downloadEvents.on('download_ready', listener);
    try {
      const jobPromise = await service.startDownload(meta);
      await jobPromise;
    } finally {
      downloadEvents.off('download_ready', listener);
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ trackId: 42 });
  });

  it('emits download_failed with the correct trackId and error message on failure', async () => {
    const meta: TrackMeta = { id: 42, title: 'Sunrise', artistName: 'DJ Sol', albumTitle: null, bpm: null };
    const errorMessage = 'yt-dlp not installed';

    const runner = async (_m: TrackMeta): Promise<string> => {
      throw new Error(errorMessage);
    };
    const service = new DownloadService(db, runner);

    const received: Array<{ trackId: number; error: string }> = [];
    const listener = (payload: { trackId: number; error: string }) => {
      received.push(payload);
    };

    downloadEvents.on('download_failed', listener);
    try {
      const jobPromise = await service.startDownload(meta);
      await jobPromise;
    } finally {
      downloadEvents.off('download_failed', listener);
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ trackId: 42, error: errorMessage });
  });

  it('does not emit download_ready on failure', async () => {
    const meta: TrackMeta = { id: 42, title: 'Sunrise', artistName: 'DJ Sol', albumTitle: null, bpm: null };

    const runner = async (_m: TrackMeta): Promise<string> => {
      throw new Error('boom');
    };
    const service = new DownloadService(db, runner);

    const readyEvents: unknown[] = [];
    const readyListener = (payload: unknown) => { readyEvents.push(payload); };

    downloadEvents.on('download_ready', readyListener);
    try {
      const jobPromise = await service.startDownload(meta);
      await jobPromise;
    } finally {
      downloadEvents.off('download_ready', readyListener);
    }

    expect(readyEvents).toHaveLength(0);
  });

  it('does not emit download_failed on success', async () => {
    const meta: TrackMeta = { id: 42, title: 'Sunrise', artistName: 'DJ Sol', albumTitle: null, bpm: null };
    const fakePath = join(dir, 'DJ Sol - Sunrise.mp3');

    const runner = async (_m: TrackMeta): Promise<string> => fakePath;
    const service = new DownloadService(db, runner);

    const failedEvents: unknown[] = [];
    const failedListener = (payload: unknown) => { failedEvents.push(payload); };

    downloadEvents.on('download_failed', failedListener);
    try {
      const jobPromise = await service.startDownload(meta);
      await jobPromise;
    } finally {
      downloadEvents.off('download_failed', failedListener);
    }

    expect(failedEvents).toHaveLength(0);
  });
});
