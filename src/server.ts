import { createApp } from './app';
import { connectMongo } from './db/mongo';
import { config } from './config';
import { logger } from './lib/logger';
import { getRedis } from './lib/redis';

async function bootstrap() {
  await connectMongo();
  // Прогреваем подключение к Redis на старте, чтобы упасть раньше при проблемах.
  getRedis();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`Payment service listening on port ${config.port}`);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
