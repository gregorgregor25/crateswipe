import { config } from './config.js';
import { buildServer } from './server.js';

const start = async (): Promise<void> => {
  const app = buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`crateswipe-api listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
