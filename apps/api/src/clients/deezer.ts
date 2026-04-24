import type { Database as DB } from 'better-sqlite3';
import { config } from '../config.js';

export type DeezerTrack = {
  id: number;
  title: string;
  duration: number;
  preview: string;
  md5_image: string;
  artist: { id: number; name: string };
  album: {
    id: number;
    title: string;
    cover_medium: string;
    cover_big: string;
  };
};

export type DeezerTrackFull = DeezerTrack & {
  release_date?: string;
  isrc?: string;
  bpm?: number;
  gain?: number;
  contributors?: Array<{ id: number; name: string; role: string }>;
  album: DeezerTrack['album'] & {
    label?: string;
    genre_id?: number;
  };
};

export type DeezerGenre = { id: number; name: string };

export type DeezerChartResponse = {
  tracks: { data: DeezerTrack[] };
};

export type DeezerRadioTracksResponse = { data: DeezerTrack[] };

export type DeezerSearchResponse = { data: DeezerTrack[]; total: number };

type CacheRow = { value: string; fetched_at: number };

const CACHE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS deezer_cache (
  path TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

export type DeezerClientOptions = {
  baseUrl?: string;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class DeezerClient {
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly db: DB,
    options: DeezerClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? config.deezer.baseUrl;
    this.cacheTtlMs = options.cacheTtlMs ?? 24 * 60 * 60 * 1000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.db.exec(CACHE_TABLE_SQL);
  }

  async getTrack(id: number): Promise<DeezerTrackFull> {
    return this.request<DeezerTrackFull>(`/track/${id}`);
  }

  async searchTracks(query: string, limit = 25): Promise<DeezerSearchResponse> {
    const q = encodeURIComponent(query);
    return this.request<DeezerSearchResponse>(`/search/track?q=${q}&limit=${limit}`);
  }

  async getGenreChart(genreId: number, limit = 50): Promise<DeezerTrack[]> {
    const chart = await this.request<DeezerChartResponse>(
      `/chart/${genreId}?limit=${limit}`,
    );
    return chart.tracks.data;
  }

  async getRadioTracks(radioId: number): Promise<DeezerTrack[]> {
    const res = await this.request<DeezerRadioTracksResponse>(`/radio/${radioId}/tracks`);
    return res.data;
  }

  async getRelatedArtists(artistId: number): Promise<Array<{ id: number; name: string }>> {
    type Resp = { data: Array<{ id: number; name: string }> };
    const res = await this.request<Resp>(`/artist/${artistId}/related`);
    return res.data;
  }

  async getArtistTopTracks(artistId: number, limit = 10): Promise<DeezerTrack[]> {
    const res = await this.request<DeezerRadioTracksResponse>(
      `/artist/${artistId}/top?limit=${limit}`,
    );
    return res.data;
  }

  async getGenres(): Promise<DeezerGenre[]> {
    const res = await this.request<{ data: DeezerGenre[] }>('/genre');
    return res.data;
  }

  private async request<T>(path: string): Promise<T> {
    const cached = this.readCache(path);
    if (cached !== null) return cached as T;

    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Deezer request failed: ${response.status} ${url}`);
    }
    const body = (await response.json()) as unknown;
    // Deezer returns { error: { code, message } } on failure with 200
    if (body && typeof body === 'object' && 'error' in body && body.error) {
      throw new Error(`Deezer API error: ${JSON.stringify(body.error)}`);
    }
    this.writeCache(path, body);
    return body as T;
  }

  private readCache(path: string): unknown | null {
    const row = this.db
      .prepare<[string], CacheRow>('SELECT value, fetched_at FROM deezer_cache WHERE path = ?')
      .get(path);
    if (!row) return null;
    if (this.now() - row.fetched_at > this.cacheTtlMs) return null;
    return JSON.parse(row.value);
  }

  private writeCache(path: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO deezer_cache (path, value, fetched_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT (path) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
      )
      .run(path, JSON.stringify(value), this.now());
  }

  clearCache(): void {
    this.db.exec('DELETE FROM deezer_cache');
  }
}
