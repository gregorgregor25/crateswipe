import type { Database as DB } from 'better-sqlite3';
import type { DeezerClient, DeezerTrack } from '../clients/deezer.js';

// Phase 1 stub — used until Phase 2.5 onboarding captures per-user preferences.
// Deezer genre IDs from https://api.deezer.com/genre
export const DEFAULT_SEED_GENRE_IDS = [
  113, // Dance
  106, // Electro
  132, // House (Deezer "House" falls under Electro; keep multiple for breadth)
  152, // Rock - included for sanity to test broader coverage
];

export type DeckTrack = {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  albumTitle: string | null;
  artworkUrl: string;
  previewUrl: string;
  durationMs: number | null;
  genreName: string | null;
  bpm: number | null;
  keyCamelot: string | null;
};

type TrackRow = {
  id: number;
  title: string;
  artist_id: number;
  artist_name: string;
  album_title: string | null;
  artwork_url: string;
  preview_url: string;
  duration_ms: number | null;
  genre_name: string | null;
};

type BpmRow = { bpm: number | null; key_camelot: string | null };

const upsertTrack = (db: DB, track: DeezerTrack, genreName: string | null, now: number): void => {
  db.prepare(
    `INSERT INTO tracks (
      id, title, artist_id, artist_name,
      album_id, album_title,
      genre_name,
      preview_url, artwork_url, duration_ms,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      artist_name = excluded.artist_name,
      album_title = excluded.album_title,
      genre_name = COALESCE(tracks.genre_name, excluded.genre_name),
      preview_url = excluded.preview_url,
      artwork_url = excluded.artwork_url,
      duration_ms = excluded.duration_ms,
      fetched_at = excluded.fetched_at`,
  ).run(
    track.id,
    track.title,
    track.artist.id,
    track.artist.name,
    track.album.id,
    track.album.title,
    genreName,
    track.preview,
    track.album.cover_big || track.album.cover_medium,
    track.duration * 1000,
    now,
  );
};

export type DeckServiceOptions = {
  seedGenreIds?: readonly number[];
  now?: () => number;
  shuffle?: <T>(arr: T[]) => T[];
};

const defaultShuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const ai = a[i];
    const aj = a[j];
    if (ai !== undefined && aj !== undefined) {
      a[i] = aj;
      a[j] = ai;
    }
  }
  return a;
};

export class DeckService {
  private readonly seedGenreIds: readonly number[];
  private readonly now: () => number;
  private readonly shuffle: <T>(arr: T[]) => T[];

  constructor(
    private readonly db: DB,
    private readonly deezer: DeezerClient,
    options: DeckServiceOptions = {},
  ) {
    this.seedGenreIds = options.seedGenreIds ?? DEFAULT_SEED_GENRE_IDS;
    this.now = options.now ?? Date.now;
    this.shuffle = options.shuffle ?? defaultShuffle;
  }

  async generateDeck(userId: number, n: number): Promise<DeckTrack[]> {
    const seen = this.getSeenTrackIds(userId);
    const collected: DeezerTrack[] = [];
    const byId = new Map<number, DeezerTrack>();

    for (const genreId of this.seedGenreIds) {
      const tracks = await this.deezer.getGenreChart(genreId).catch(() => []);
      for (const t of tracks) {
        if (byId.has(t.id) || seen.has(t.id)) continue;
        if (!t.preview) continue; // Phase 1 requires a preview URL
        byId.set(t.id, t);
        collected.push(t);
      }
    }

    const now = this.now();
    const insertMany = this.db.transaction((tracks: DeezerTrack[]) => {
      for (const t of tracks) upsertTrack(this.db, t, null, now);
    });
    insertMany(collected);

    const chosen = this.shuffle(collected).slice(0, n);

    return chosen.map((t) => this.enrich(t.id));
  }

  private getSeenTrackIds(userId: number): Set<number> {
    const rows = this.db
      .prepare<[number], { track_id: number }>(
        'SELECT track_id FROM swipes WHERE user_id = ?',
      )
      .all(userId);
    return new Set(rows.map((r) => r.track_id));
  }

  private enrich(trackId: number): DeckTrack {
    const track = this.db
      .prepare<[number], TrackRow>(
        `SELECT id, title, artist_id, artist_name, album_title, artwork_url, preview_url, duration_ms, genre_name
         FROM tracks WHERE id = ?`,
      )
      .get(trackId);
    if (!track) throw new Error(`Track ${trackId} missing from cache after upsert`);
    const bpm = this.db
      .prepare<[number], BpmRow>(
        'SELECT bpm, key_camelot FROM bpm_cache WHERE track_id = ?',
      )
      .get(trackId);
    return {
      id: track.id,
      title: track.title,
      artistId: track.artist_id,
      artistName: track.artist_name,
      albumTitle: track.album_title,
      artworkUrl: track.artwork_url,
      previewUrl: track.preview_url,
      durationMs: track.duration_ms,
      genreName: track.genre_name,
      bpm: bpm?.bpm ?? null,
      keyCamelot: bpm?.key_camelot ?? null,
    };
  }
}
