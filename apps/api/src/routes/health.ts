import type { FastifyInstance } from 'fastify';
import { packageVersion } from '../config.js';

export const registerHealthRoute = (app: FastifyInstance): void => {
  app.get('/health', async () => ({
    ok: true,
    version: packageVersion,
  }));
};
