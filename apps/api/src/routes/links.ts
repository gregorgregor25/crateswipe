import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { OdesliClient } from '../clients/odesli.js';

export async function registerLinksRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/tracks/:id/links',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    async (req, reply) => {
      const trackId = parseInt(req.params.id, 10);
      if (isNaN(trackId)) return reply.status(400).send({ error: 'invalid track id' });

      const db = getDb();
      const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(trackId);
      if (!track) return reply.status(404).send({ error: 'track not found' });

      const client = new OdesliClient(db);
      const deezerUrl = `https://www.deezer.com/track/${trackId}`;
      const links = await client.getLinks(trackId, deezerUrl);
      return reply.send({ links });
    },
  );
}
