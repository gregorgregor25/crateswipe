import type { FastifyInstance } from 'fastify';

export const registerWhoamiRoute = (app: FastifyInstance): void => {
  app.get('/whoami', async (req, reply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'Not authenticated', code: 'AUTH_MISSING' });
      return;
    }
    return req.user;
  });
};
