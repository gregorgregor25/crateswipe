import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { openDbAt, setDbInstance } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { GetSongBpmClient } from '../src/clients/getsongbpm.js';

let dir: string;
let db: DB;

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const insertTrack = (id: number): void => {
  const now = Date.now();
  db.prepare(
    'INSERT INTO tracks (id, title, artist_id, artist_name, preview_url, artwork_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'Test Track', 10, 'Test Artist', 'http://p.mp3', 'http://art.jpg', now);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-getsongbpm-'));
  db = openDbAt(join(dir, 'test.sqlite'));
  applyMigrations(db);
  setDbInstance(db);
});

afterEach(() => {
  setDbInstance(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GetSongBpmClient', () => {
  it('returns BPM and key when API returns a result', async () => {
    insertTrack(1);
    const apiResponse = {
      search: [
        {
          id: '12345',
          title: 'Track Name',
          tempo: '128',
          key_of: '8A',
          artist: { id: '567', name: 'Artist Name' },
        },
      ],
    };
    const fetchMock = vi.fn(async () => okResponse(apiResponse));
    const client = new GetSongBpmClient(db, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    const result = await client.getBpm(1, 'Artist Name', 'Track Name');

    expect(result.bpm).toBe(128);
    expect(result.keyCamelot).toBe('8A');
    expect(result.keyStandard).toBe('A minor');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const row = db
      .prepare('SELECT bpm, key_camelot, key_standard, source FROM bpm_cache WHERE track_id = ?')
      .get(1) as { bpm: number; key_camelot: string; key_standard: string; source: string };
    expect(row).not.toBeNull();
    expect(row.bpm).toBe(128);
    expect(row.key_camelot).toBe('8A');
    expect(row.key_standard).toBe('A minor');
    expect(row.source).toBe('getsongbpm');
  });

  it('returns nulls when API returns empty search array', async () => {
    insertTrack(2);
    const fetchMock = vi.fn(async () => okResponse({ search: [] }));
    const client = new GetSongBpmClient(db, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    const result = await client.getBpm(2, 'Unknown Artist', 'Unknown Track');

    expect(result).toEqual({ bpm: null, keyCamelot: null, keyStandard: null });

    const row = db
      .prepare('SELECT bpm, key_camelot, key_standard FROM bpm_cache WHERE track_id = ?')
      .get(2) as { bpm: number | null; key_camelot: string | null; key_standard: string | null };
    expect(row).not.toBeNull();
    expect(row.bpm).toBeNull();
    expect(row.key_camelot).toBeNull();
    expect(row.key_standard).toBeNull();
  });

  it('returns cached result without fetching', async () => {
    insertTrack(3);
    db.prepare(
      'INSERT INTO bpm_cache (track_id, bpm, key_camelot, key_standard, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(3, 140, '9B', 'G major', 'getsongbpm', Date.now());

    const fetchMock = vi.fn(async () => okResponse({ search: [] }));
    const client = new GetSongBpmClient(db, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    const result = await client.getBpm(3, 'Some Artist', 'Some Track');

    expect(result.bpm).toBe(140);
    expect(result.keyCamelot).toBe('9B');
    expect(result.keyStandard).toBe('G major');
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('maps key_of to key_standard correctly', async () => {
    insertTrack(10);
    insertTrack(11);

    const client8A = new GetSongBpmClient(db, {
      apiKey: 'test-key',
      fetchImpl: vi.fn(async () =>
        okResponse({ search: [{ id: '1', title: 'T', tempo: '120', key_of: '8A', artist: { id: '1', name: 'A' } }] }),
      ),
    });
    const result8A = await client8A.getBpm(10, 'Artist', 'Track');
    expect(result8A.keyCamelot).toBe('8A');
    expect(result8A.keyStandard).toBe('A minor');

    const client9B = new GetSongBpmClient(db, {
      apiKey: 'test-key',
      fetchImpl: vi.fn(async () =>
        okResponse({ search: [{ id: '2', title: 'T', tempo: '130', key_of: '9B', artist: { id: '2', name: 'B' } }] }),
      ),
    });
    const result9B = await client9B.getBpm(11, 'Artist', 'Track');
    expect(result9B.keyCamelot).toBe('9B');
    expect(result9B.keyStandard).toBe('G major');
  });

  it('treats tempo "0" as null BPM but still captures key', async () => {
    insertTrack(4);
    const apiResponse = {
      search: [
        {
          id: '999',
          title: 'Mystery Track',
          tempo: '0',
          key_of: '8A',
          artist: { id: '100', name: 'Mystery Artist' },
        },
      ],
    };
    const fetchMock = vi.fn(async () => okResponse(apiResponse));
    const client = new GetSongBpmClient(db, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    const result = await client.getBpm(4, 'Mystery Artist', 'Mystery Track');

    expect(result.bpm).toBeNull();
    expect(result.keyCamelot).toBe('8A');
    expect(result.keyStandard).toBe('A minor');
  });
});
