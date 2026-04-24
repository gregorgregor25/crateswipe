import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';

type CrateTrack = {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  albumTitle: string | null;
  artworkUrl: string;
  previewUrl: string;
  durationMs: number | null;
  bpm: number | null;
  keyCamelot: string | null;
  keyStandard: string | null;
  likedAt: number;
};

type CrateRow = {
  id: number;
  title: string;
  artist_id: number;
  artist_name: string;
  album_title: string | null;
  artwork_url: string;
  preview_url: string;
  duration_ms: number | null;
  bpm: number | null;
  key_camelot: string | null;
  key_standard: string | null;
  liked_at: number;
};

export const registerCrateRoute = (app: FastifyInstance): void => {
  app.get('/crate', async (req, reply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'Not authenticated', code: 'AUTH_MISSING' });
      return;
    }

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT
          t.id,
          t.title,
          t.artist_id,
          t.artist_name,
          t.album_title,
          t.artwork_url,
          t.preview_url,
          t.duration_ms,
          b.bpm,
          b.key_camelot,
          b.key_standard,
          c.liked_at
        FROM crates c
        JOIN tracks t ON c.track_id = t.id
        LEFT JOIN bpm_cache b ON b.track_id = t.id
        WHERE c.user_id = ?
        ORDER BY c.liked_at DESC`,
      )
      .all(req.user.id) as CrateRow[];

    const tracks: CrateTrack[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      artistId: row.artist_id,
      artistName: row.artist_name,
      albumTitle: row.album_title,
      artworkUrl: row.artwork_url,
      previewUrl: row.preview_url,
      durationMs: row.duration_ms,
      bpm: row.bpm,
      keyCamelot: row.key_camelot,
      keyStandard: row.key_standard,
      likedAt: row.liked_at,
    }));

    return { tracks };
  });
};
