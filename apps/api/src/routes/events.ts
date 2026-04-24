import type { FastifyInstance } from 'fastify';
import { downloadEvents } from '../events.js';

export async function registerEventsRoute(app: FastifyInstance): Promise<void> {
  app.get('/events', async (req, reply) => {
    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    const onReady = ({ trackId }: { trackId: number }) => {
      reply.raw.write(`event: download_ready\ndata: ${JSON.stringify({ trackId })}\n\n`);
    };
    const onFailed = ({ trackId, error }: { trackId: number; error: string }) => {
      reply.raw.write(`event: download_failed\ndata: ${JSON.stringify({ trackId, error })}\n\n`);
    };

    downloadEvents.on('download_ready', onReady);
    downloadEvents.on('download_failed', onFailed);

    // Clean up when client disconnects
    req.raw.on('close', () => {
      downloadEvents.off('download_ready', onReady);
      downloadEvents.off('download_failed', onFailed);
    });

    // Keep the connection open — Fastify won't close it because we write directly to raw
    // Return a never-resolving promise
    await new Promise<void>((resolve) => {
      req.raw.on('close', resolve);
    });
  });
}
