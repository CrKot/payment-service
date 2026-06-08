import express from 'express';
import { jsonWithRawBody } from './middlewares/rawBody';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { invoiceRouter } from './modules/invoice/invoice.routes';
import { webhookRouter } from './modules/webhook/webhook.routes';

/** Собирает Express-приложение без подключения к БД и без listen (удобно для тестов). */
export function createApp() {
  const app = express();

  // JSON-парсер с захватом сырого тела (для HMAC).
  app.use(jsonWithRawBody);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/invoice', invoiceRouter);
  app.use('/webhook', webhookRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
