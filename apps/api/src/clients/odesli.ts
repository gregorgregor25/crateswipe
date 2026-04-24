import type { Database as DB } from 'better-sqlite3';
import { config } from '../config.js';

export type OdesliClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type CacheRow = { links_json: string; fetched_at: number };

export class OdesliClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly db: DB,
    options: OdesliClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? config.odesli.baseUrl;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async getLinks(trackId: number, deezerTrackUrl: string): Promise<unknown> {
    const cached = this.db
      .prepare<[number], CacheRow>(
        'SELECT links_json, fetched_at FROM odesli_cache WHERE track_id = ?',
      )
      .get(trackId);

    if (cached) {
      return JSON.parse(cached.links_json);
    }

    const url = `${this.baseUrl}/links?url=${encodeURIComponent(deezerTrackUrl)}&userCountry=GB`;
    const response = await this.fetchImpl(url);

    if (!response.ok) {
      throw new Error(`Odesli request failed: ${response.status}`);
    }

    const body = (await response.json()) as unknown;

    this.db
      .prepare(
        'INSERT INTO odesli_cache (track_id, links_json, fetched_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT (track_id) DO UPDATE SET links_json = excluded.links_json, fetched_at = excluded.fetched_at',
      )
      .run(trackId, JSON.stringify(body), this.now());

    return body;
  }
}
