import type { Database as DB } from 'better-sqlite3';
import { requireGetSongBpm } from '../config.js';

export type BpmResult = {
  bpm: number | null;
  keyCamelot: string | null;
  keyStandard: string | null;
};

export type GetSongBpmClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const CAMELOT_TO_STANDARD: Record<string, string> = {
  '1A': 'Ab minor',
  '1B': 'B major',
  '2A': 'Eb minor',
  '2B': 'F# major',
  '3A': 'Bb minor',
  '3B': 'Db major',
  '4A': 'F minor',
  '4B': 'Ab major',
  '5A': 'C minor',
  '5B': 'Eb major',
  '6A': 'G minor',
  '6B': 'Bb major',
  '7A': 'D minor',
  '7B': 'F major',
  '8A': 'A minor',
  '8B': 'C major',
  '9A': 'E minor',
  '9B': 'G major',
  '10A': 'B minor',
  '10B': 'D major',
  '11A': 'F# minor',
  '11B': 'A major',
  '12A': 'Db minor',
  '12B': 'E major',
};

type BpmCacheRow = {
  bpm: number | null;
  key_camelot: string | null;
  key_standard: string | null;
};

type SearchItem = {
  id?: string;
  title?: string;
  tempo?: string;
  key_of?: string;
  artist?: { id?: string; name?: string };
};

type SearchResponse = {
  search?: SearchItem[] | null;
};

export class GetSongBpmClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly apiKeyOverride: string | undefined;

  constructor(
    private readonly db: DB,
    options: GetSongBpmClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? 'https://api.getsongbpm.com';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.apiKeyOverride = options.apiKey;
  }

  async getBpm(trackId: number, artist: string, title: string): Promise<BpmResult> {
    const cached = this.readCache(trackId);
    if (cached !== null) {
      return cached;
    }

    const apiKey = this.apiKeyOverride ?? requireGetSongBpm().apiKey;
    const lookup = encodeURIComponent(`${artist} ${title}`);
    const url = `${this.baseUrl}/search/?api_key=${apiKey}&type=song&lookup=${lookup}`;

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`GetSongBPM request failed: ${response.status} ${url}`);
    }

    let result: BpmResult;
    try {
      const body = (await response.json()) as SearchResponse;
      const items = body.search;
      if (!items || !Array.isArray(items) || items.length === 0) {
        result = { bpm: null, keyCamelot: null, keyStandard: null };
      } else {
        const first = items[0] as SearchItem;
        const tempoStr = first.tempo ?? '';
        const tempoNum = parseFloat(tempoStr);
        const bpm = !isNaN(tempoNum) && tempoNum > 0 ? Math.round(tempoNum) : null;

        const keyRaw = typeof first.key_of === 'string' && first.key_of.trim() !== ''
          ? first.key_of.trim()
          : null;
        const keyStandard = keyRaw !== null ? (CAMELOT_TO_STANDARD[keyRaw] ?? null) : null;

        result = { bpm, keyCamelot: keyRaw, keyStandard };
      }
    } catch {
      result = { bpm: null, keyCamelot: null, keyStandard: null };
    }

    this.writeCache(trackId, result);
    return result;
  }

  private readCache(trackId: number): BpmResult | null {
    const row = this.db
      .prepare<[number], BpmCacheRow>(
        'SELECT bpm, key_camelot, key_standard FROM bpm_cache WHERE track_id = ?',
      )
      .get(trackId);
    if (!row) return null;
    return {
      bpm: row.bpm ?? null,
      keyCamelot: row.key_camelot ?? null,
      keyStandard: row.key_standard ?? null,
    };
  }

  private writeCache(trackId: number, result: BpmResult): void {
    this.db
      .prepare(
        'INSERT INTO bpm_cache (track_id, bpm, key_camelot, key_standard, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT (track_id) DO UPDATE SET bpm = excluded.bpm, key_camelot = excluded.key_camelot, ' +
          'key_standard = excluded.key_standard, source = excluded.source, fetched_at = excluded.fetched_at',
      )
      .run(trackId, result.bpm, result.keyCamelot, result.keyStandard, 'getsongbpm', this.now());
  }
}
