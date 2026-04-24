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

const seedTrack = (id: number, overrides: Partial<{
  title: string;
  artistId: number;
  artistName: string;
  albumTitle: string;
  previewUrl: string;
  artworkUrl: string;
  durationMs: number;
}> = {}): void => {
  db.prepare(
    'INSERT INTO tracks (id, title, artist_id, artist_name, album_title, preview_url, artwork_url, duration_ms, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    overrides.title ?? `Track ${id}`,
    overrides.artistId ?? id * 10,
    overrides.artistName ?? `Artist ${id * 10}`,
    overrides.albumTitle ?? `Album ${id}`,
    overrides.previewUrl ?? `https://preview.example/${id}.mp3`,
    overrides.artworkUrl ?? `https://art.example/${id}.jpg`,
    overrides.durationMs ?? 210000,
    Date.now(),
  );
};

const likeCrate = (userId: number, trackId: number, likedAt = Date.now()): void => {
  db.prepare('INSERT INTO crates (user_id, track_id, liked_at) VALUES (?, ?, ?)').run(
    userId,
    trackId,
    likedAt,
  );
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-crate-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /crate', () => {
  it('returns empty crate for new user', async () => {
    const { token } = seedUser();

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/crate',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tracks: [] });
  });

  it('returns liked tracks with correct metadata', async () => {
    const { userId, token } = seedUser();
    seedTrack(1, {
      title: 'Sunrise',
      artistId: 42,
      artistName: 'DJ Sol',
      albumTitle: 'Morning Set',
      previewUrl: 'https://preview.example/1.mp3',
      artworkUrl: 'https://art.example/1.jpg',
      durationMs: 240000,
    });
    const likedAt = 1714000000000;
    likeCrate(userId, 1, likedAt);

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/crate',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tracks: unknown[] }>();
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0]).toMatchObject({
      id: 1,
      title: 'Sunrise',
      artistId: 42,
      artistName: 'DJ Sol',
      albumTitle: 'Morning Set',
      previewUrl: 'https://preview.example/1.mp3',
      artworkUrl: 'https://art.example/1.jpg',
      durationMs: 240000,
      likedAt,
    });
  });

  it('does not include passed tracks', async () => {
    const { userId, token } = seedUser();
    seedTrack(1, { title: 'Liked Track' });
    seedTrack(2, { title: 'Passed Track' });

    // Like track 1, pass track 2 (only insert to swipes, not crates)
    likeCrate(userId, 1);
    db.prepare(
      'INSERT INTO swipes (user_id, track_id, direction, listened_ms, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, 2, 'pass', 5000, 'test-session', Date.now());

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/crate',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tracks: Array<{ id: number; title: string }> }>();
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0]!.id).toBe(1);
    expect(body.tracks[0]!.title).toBe('Liked Track');
  });

  it('includes BPM and key data when cached', async () => {
    const { userId, token } = seedUser();
    seedTrack(1);
    likeCrate(userId, 1);

    db.prepare(
      'INSERT INTO bpm_cache (track_id, bpm, key_camelot, key_standard, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(1, 128, '8A', 'A minor', 'getsongbpm', Date.now());

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/crate',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tracks: Array<{ bpm: number; keyCamelot: string; keyStandard: string }> }>();
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0]!.bpm).toBe(128);
    expect(body.tracks[0]!.keyCamelot).toBe('8A');
    expect(body.tracks[0]!.keyStandard).toBe('A minor');
  });

  it('returns bpm/key as null when not cached', async () => {
    const { userId, token } = seedUser();
    seedTrack(1);
    likeCrate(userId, 1);

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/crate',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tracks: Array<{ bpm: null; keyCamelot: null; keyStandard: null }> }>();
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0]!.bpm).toBeNull();
    expect(body.tracks[0]!.keyCamelot).toBeNull();
    expect(body.tracks[0]!.keyStandard).toBeNull();
  });

  it('returns tracks ordered by liked_at descending', async () => {
    const { userId, token } = seedUser();
    seedTrack(1, { title: 'First Liked' });
    seedTrack(2, { title: 'Second Liked' });
    seedTrack(3, { title: 'Third Liked' });

    likeCrate(userId, 1, 1714000000000);
    likeCrate(userId, 2, 1714000001000);
    likeCrate(userId, 3, 1714000002000);

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/crate',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tracks: Array<{ id: number }> }>();
    expect(body.tracks.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it('returns 401 without token', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/crate' });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});
