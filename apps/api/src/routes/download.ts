import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { DownloadService } from '../services/download.js';

type TrackRow = {
  id: number;
  title: string;
  artist_name: string;
  album_title: string | null;
};

type DownloadRow = {
  status: string;
  file_path: string | null;
};

type BpmRow = {
  bpm: number | null;
};

export async function registerDownloadRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { track_id: number } }>(
    '/download',
    {
      schema: {
        body: {
          type: 'object',
          required: ['track_id'],
          properties: { track_id: { type: 'integer' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { track_id } = req.body;
      const userId = req.user!.id;
      const db = getDb();

      // 404 if track not found
      const track = db
        .prepare('SELECT id, title, artist_name, album_title FROM tracks WHERE id = ?')
        .get(track_id) as TrackRow | undefined;
      if (!track) return reply.status(404).send({ error: 'track not found' });

      // 403 if not in user's crate
      const inCrate = db
        .prepare('SELECT 1 FROM crates WHERE user_id = ? AND track_id = ?')
        .get(userId, track_id);
      if (!inCrate) return reply.status(403).send({ error: 'track not in your crate' });

      // Check existing download status
      const existing = db
        .prepare('SELECT status, file_path FROM downloads WHERE track_id = ?')
        .get(track_id) as DownloadRow | undefined;

      if (existing?.status === 'ready') {
        return reply.send({ status: 'ready', file_path: existing.file_path });
      }
      if (existing?.status === 'queued' || existing?.status === 'downloading') {
        return reply.status(202).send({ status: existing.status });
      }

      // Get BPM from cache
      const bpmRow = db
        .prepare('SELECT bpm FROM bpm_cache WHERE track_id = ?')
        .get(track_id) as BpmRow | undefined;

      const service = new DownloadService(db);
      // Fire-and-forget — do not await the returned inner promise
      void service.startDownload({
        id: track.id,
        title: track.title,
        artistName: track.artist_name,
        albumTitle: track.album_title,
        bpm: bpmRow?.bpm ?? null,
      });

      return reply.status(202).send({ status: 'queued' });
    },
  );
}
