import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt, setDbInstance } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { OdesliClient } from '../src/clients/odesli.js';
import { hashToken, signToken } from '../src/middleware/auth.js';
import { buildServer } from '../src/server.js';

let dir: string;
let db: DB;

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const seedTrack = (id = 1): void => {
  db.prepare(
    'INSERT INTO tracks (id, title, artist_id, artist_name, preview_url, artwork_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'Test Track', 10, 'Artist Name', 'http://p.mp3', 'http://art.jpg', Date.now());
};

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
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-odesli-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('OdesliClient', () => {
  it('fetches links from API and caches them', async () => {
    seedTrack(42);

    const odesliBody = {
      entityUniqueId: 'DEEZER_SONG::42',
      linksByPlatform: {
        spotify: { url: 'https://open.spotify.com/track/abc123' },
        appleMusic: { url: 'https://music.apple.com/track/xyz' },
      },
    };
    const fetchMock = vi.fn(async () => okResponse(odesliBody));
    const client = new OdesliClient(db, { fetchImpl: fetchMock });

    const result = await client.getLinks(42, 'https://www.deezer.com/track/42');

    expect(result).toEqual(odesliBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0]![0] as string;
    expect(callUrl).toContain('deezer.com%2Ftrack%2F42');
    expect(callUrl).toContain('userCountry=GB');

    const row = db
      .prepare('SELECT links_json FROM odesli_cache WHERE track_id = ?')
      .get(42) as { links_json: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.links_json)).toEqual(odesliBody);
  });

  it('returns cached result without fetching', async () => {
    seedTrack(7);

    const cached = { linksByPlatform: { youtube: { url: 'https://youtube.com/watch?v=xyz' } } };
    db.prepare(
      'INSERT INTO odesli_cache (track_id, links_json, fetched_at) VALUES (?, ?, ?)',
    ).run(7, JSON.stringify(cached), Date.now());

    const fetchMock = vi.fn();
    const client = new OdesliClient(db, { fetchImpl: fetchMock });

    const result = await client.getLinks(7, 'https://www.deezer.com/track/7');

    expect(result).toEqual(cached);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('throws on non-ok API response', async () => {
    seedTrack(99);

    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const client = new OdesliClient(db, { fetchImpl: fetchMock });

    await expect(client.getLinks(99, 'https://www.deezer.com/track/99')).rejects.toThrow(
      'Odesli request failed: 429',
    );
  });
});

describe('GET /tracks/:id/links', () => {
  it('returns 401 without a token', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/tracks/1/links' });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown track', async () => {
    const { token } = seedUser();
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/tracks/99999/links',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'track not found' });
  });

  it('returns 200 with links from cache', async () => {
    seedTrack(5);
    const { token } = seedUser();

    const cachedData = { linksByPlatform: { spotify: { url: 'https://open.spotify.com/x' } } };
    db.prepare(
      'INSERT INTO odesli_cache (track_id, links_json, fetched_at) VALUES (?, ?, ?)',
    ).run(5, JSON.stringify(cachedData), Date.now());

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/tracks/5/links',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ links: cachedData });
  });
});
