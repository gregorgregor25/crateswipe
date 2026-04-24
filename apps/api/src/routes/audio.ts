import { createReadStream, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';

type DownloadRow = {
  status: string;
  file_path: string | null;
  artist_name: string;
  title: string;
};

export function registerAudioRoute(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/tracks/:id/audio', async (req, reply) => {
    const trackId = Number(req.params.id);
    if (!Number.isInteger(trackId) || trackId <= 0) {
      return reply.status(400).send({ error: 'invalid track id' });
    }

    const db = getDb();

    const row = db
      .prepare(
        `SELECT d.status, d.file_path, t.artist_name, t.title
         FROM downloads d
         JOIN tracks t ON t.id = d.track_id
         WHERE d.track_id = ?`,
      )
      .get(trackId) as DownloadRow | undefined;

    if (!row || row.status !== 'ready') {
      return reply.status(404).send({ error: 'not downloaded' });
    }

    if (!row.file_path || !existsSync(row.file_path)) {
      return reply.status(404).send({ error: 'file not found' });
    }

    const filename = `${row.artist_name} - ${row.title}.mp3`;
    const safeFilename = filename.replace(/[^\w\s.\-]/g, '_');

    void reply.header('Content-Type', 'audio/mpeg');
    void reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);

    return reply.send(createReadStream(row.file_path));
  });
}
