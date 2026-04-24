import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database as DB } from 'better-sqlite3';
import { config } from '../config.js';
import { getDb } from '../db/client.js';

export type AuthUser = {
  id: number;
  displayName: string;
  isAdmin: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

type TokenPayload = {
  userId: number;
  displayName: string;
  isAdmin: boolean;
};

const PUBLIC_PATHS = new Set<string>(['/health']);

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const signToken = (payload: TokenPayload): string =>
  jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256' });

export const verifyToken = (token: string): TokenPayload => {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('Invalid token payload');
  const { userId, displayName, isAdmin } = decoded as Partial<TokenPayload>;
  if (typeof userId !== 'number' || typeof displayName !== 'string' || typeof isAdmin !== 'boolean') {
    throw new Error('Malformed token payload');
  }
  return { userId, displayName, isAdmin };
};

const loadUserFromToken = (db: DB, rawToken: string): AuthUser | null => {
  let payload: TokenPayload;
  try {
    payload = verifyToken(rawToken);
  } catch {
    return null;
  }
  const tokenRow = db
    .prepare('SELECT id, user_id FROM tokens WHERE token_hash = ?')
    .get(hashToken(rawToken)) as { id: number; user_id: number } | undefined;
  if (!tokenRow || tokenRow.user_id !== payload.userId) return null;
  const userRow = db
    .prepare('SELECT id, display_name, is_admin FROM users WHERE id = ?')
    .get(payload.userId) as
    | { id: number; display_name: string; is_admin: number }
    | undefined;
  if (!userRow) return null;
  db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), tokenRow.id);
  return {
    id: userRow.id,
    displayName: userRow.display_name,
    isAdmin: userRow.is_admin === 1,
  };
};

const extractBearer = (req: FastifyRequest): string | null => {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
};

export const registerAuth = (app: FastifyInstance): void => {
  app.addHook('preHandler', async (req, reply) => {
    if (PUBLIC_PATHS.has(req.url.split('?')[0] ?? req.url)) return;
    const token = extractBearer(req);
    if (!token) {
      reply.code(401).send({ error: 'Missing bearer token', code: 'AUTH_MISSING' });
      return reply;
    }
    const user = loadUserFromToken(getDb(), token);
    if (!user) {
      reply.code(401).send({ error: 'Invalid or revoked token', code: 'AUTH_INVALID' });
      return reply;
    }
    req.user = user;
    return;
  });
};
