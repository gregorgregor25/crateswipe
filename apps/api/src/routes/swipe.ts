import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { randomUUID } from 'node:crypto';

type SwipeBody = {
  track_id: number;
  direction: 'like' | 'pass';
  listened_ms: number;
};

export async function registerSwipeRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SwipeBody }>('/swipe', {
    schema: {
      body: {
        type: 'object',
        required: ['track_id', 'direction', 'listened_ms'],
        properties: {
          track_id: { type: 'integer' },
          direction: { type: 'string', enum: ['like', 'pass'] },
          listened_ms: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { track_id, direction, listened_ms } = req.body;
    const userId = req.user!.id;
    const db = getDb();

    // 404 check
    const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(track_id);
    if (!track) {
      return reply.status(404).send({ error: 'track not found' });
    }

    const now = Date.now();
    // Insert swipe — ignore conflict (idempotent)
    db.prepare(
      'INSERT INTO swipes (user_id, track_id, direction, listened_ms, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    ).run(userId, track_id, direction, listened_ms, randomUUID(), now);

    if (direction === 'like') {
      db.prepare(
        'INSERT INTO crates (user_id, track_id, liked_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      ).run(userId, track_id, now);
    }

    return reply.status(204).send();
  });
}
