import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt, setDbInstance } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { DeezerClient, type DeezerTrack } from '../src/clients/deezer.js';
import { DeckService } from '../src/services/deck.js';
import { hashToken, signToken } from '../src/middleware/auth.js';
import { buildServer } from '../src/server.js';

let dir: string;
let db: DB;

const makeTrack = (id: number, artistId = id * 10, hasPreview = true): DeezerTrack => ({
  id,
  title: `Track ${id}`,
  duration: 180,
  preview: hasPreview ? `https://cdns.example/${id}.mp3` : '',
  md5_image: '',
  artist: { id: artistId, name: `Artist ${artistId}` },
  album: {
    id: id * 100,
    title: `Album ${id}`,
    cover_medium: 'm.jpg',
    cover_big: 'b.jpg',
  },
});

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-deck-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('DeckService', () => {
  it('generates a deck from seeded genres, dedupes, and upserts tracks', async () => {
    const { userId } = seedUser();
    const deezer = {
      getGenreChart: vi.fn(async (genreId: number) => {
        if (genreId === 132) return [makeTrack(1), makeTrack(2)];
        if (genreId === 106) return [makeTrack(2), makeTrack(3)]; // 2 is duplicate
        return [];
      }),
    } as unknown as DeezerClient;

    const service = new DeckService(db, deezer, {
      seedGenreIds: [132, 106],
      shuffle: (a) => a,
    });
    const deck = await service.generateDeck(userId, 10);

    expect(deck.map((t) => t.id).sort()).toEqual([1, 2, 3]);
    const cached = db.prepare('SELECT COUNT(*) as c FROM tracks').get() as { c: number };
    expect(cached.c).toBe(3);
  });

  it('excludes tracks the user has already swiped on', async () => {
    const { userId } = seedUser();
    db.prepare(
      'INSERT INTO tracks (id, title, artist_id, artist_name, preview_url, artwork_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(1, 'Old track', 10, 'A', 'p', 'c', Date.now());
    db.prepare(
      'INSERT INTO swipes (user_id, track_id, direction, listened_ms, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, 1, 'pass', 0, 'sess', Date.now());

    const deezer = {
      getGenreChart: vi.fn(async () => [makeTrack(1), makeTrack(2)]),
    } as unknown as DeezerClient;
    const service = new DeckService(db, deezer, {
      seedGenreIds: [132],
      shuffle: (a) => a,
    });
    const deck = await service.generateDeck(userId, 10);
    expect(deck.map((t) => t.id)).toEqual([2]);
  });

  it('drops tracks with no preview URL', async () => {
    const { userId } = seedUser();
    const deezer = {
      getGenreChart: vi.fn(async () => [makeTrack(1, 10, true), makeTrack(2, 20, false)]),
    } as unknown as DeezerClient;
    const service = new DeckService(db, deezer, {
      seedGenreIds: [132],
      shuffle: (a) => a,
    });
    const deck = await service.generateDeck(userId, 10);
    expect(deck.map((t) => t.id)).toEqual([1]);
  });

  it('returns at most n tracks', async () => {
    const { userId } = seedUser();
    const deezer = {
      getGenreChart: vi.fn(async () => [1, 2, 3, 4, 5].map((i) => makeTrack(i))),
    } as unknown as DeezerClient;
    const service = new DeckService(db, deezer, {
      seedGenreIds: [132],
      shuffle: (a) => a,
    });
    const deck = await service.generateDeck(userId, 3);
    expect(deck).toHaveLength(3);
  });
});

describe('GET /deck', () => {
  it('returns 401 without a token', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/deck' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
