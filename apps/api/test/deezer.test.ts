import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { DeezerClient, type DeezerChartResponse } from '../src/clients/deezer.js';

let dir: string;
let db: DB;

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-deezer-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('DeezerClient', () => {
  it('fetches a genre chart and caches it', async () => {
    const chart: DeezerChartResponse = {
      tracks: {
        data: [
          {
            id: 1,
            title: 'Track 1',
            duration: 180,
            preview: 'https://cdns.example/1.mp3',
            md5_image: 'abc',
            artist: { id: 10, name: 'Artist One' },
            album: { id: 100, title: 'Album', cover_medium: 'm.jpg', cover_big: 'b.jpg' },
          },
        ],
      },
    };
    const fetchMock = vi.fn(async () => okResponse(chart));
    const client = new DeezerClient(db, { fetchImpl: fetchMock });

    const tracks1 = await client.getGenreChart(132, 50);
    expect(tracks1).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const tracks2 = await client.getGenreChart(132, 50);
    expect(tracks2).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expires cache after TTL', async () => {
    const chart: DeezerChartResponse = {
      tracks: {
        data: [
          {
            id: 1,
            title: 'T',
            duration: 180,
            preview: 'p',
            md5_image: '',
            artist: { id: 10, name: 'A' },
            album: { id: 100, title: 'Al', cover_medium: 'm', cover_big: 'b' },
          },
        ],
      },
    };
    let currentTime = 1_000_000;
    const fetchMock = vi.fn(async () => okResponse(chart));
    const client = new DeezerClient(db, {
      fetchImpl: fetchMock,
      cacheTtlMs: 100,
      now: () => currentTime,
    });
    await client.getGenreChart(132, 50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    currentTime += 101;
    await client.getGenreChart(132, 50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on Deezer error envelope', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ error: { code: 800, message: 'No data' } }),
    );
    const client = new DeezerClient(db, { fetchImpl: fetchMock });
    await expect(client.getTrack(999999)).rejects.toThrow(/Deezer API error/);
  });

  it('throws on non-2xx HTTP', async () => {
    const fetchMock = vi.fn(
      async () => new Response('server error', { status: 500 }),
    );
    const client = new DeezerClient(db, { fetchImpl: fetchMock });
    await expect(client.getTrack(1)).rejects.toThrow(/Deezer request failed: 500/);
  });
});
