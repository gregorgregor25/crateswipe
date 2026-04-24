import type { FastifyInstance } from 'fastify';
import { DeezerClient } from '../clients/deezer.js';
import { DeckService } from '../services/deck.js';
import { getDb } from '../db/client.js';

export const registerDeckRoute = (app: FastifyInstance): void => {
  app.get<{ Querystring: { n?: string } }>('/deck', async (req, reply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'Not authenticated', code: 'AUTH_MISSING' });
      return;
    }
    const n = Math.min(Math.max(Number(req.query.n ?? 50) || 50, 1), 100);
    const db = getDb();
    const deezer = new DeezerClient(db);
    const service = new DeckService(db, deezer);
    try {
      const tracks = await service.generateDeck(req.user.id, n);
      return { tracks };
    } catch (err) {
      app.log.error({ err }, 'deck generation failed');
      reply.code(502).send({ error: 'Deck generation failed', code: 'DECK_FAILED' });
      return;
    }
  });
};
