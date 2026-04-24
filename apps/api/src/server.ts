import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './middleware/auth.js';
import { registerDeckRoute } from './routes/deck.js';
import { registerHealthRoute } from './routes/health.js';
import { registerWhoamiRoute } from './routes/whoami.js';

export const buildServer = (): FastifyInstance => {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  registerAuth(app);
  registerHealthRoute(app);
  registerWhoamiRoute(app);
  registerDeckRoute(app);

  return app;
};
