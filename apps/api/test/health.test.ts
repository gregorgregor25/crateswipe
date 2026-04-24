import { describe, expect, it, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';

const app = buildServer();

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with ok=true and version', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; version: string }>();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });
});
