import type { Request, Response, NextFunction } from 'express';
import { registerNonce, unregisterNonce } from '../../lib/redis';
import { WebhookEventModel } from '../../models/webhookEvent.model';
import { config } from '../../config';
import { AppError } from '../../lib/errors';
import { asyncHandler } from '../../lib/asyncHandler';
import type { WebhookDto } from './webhook.dto';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Первая линия защиты от повтора (без побочных эффектов):
 *  - X-Timestamp обязателен и должен быть в пределах окна свежести;
 *  - X-Nonce обязателен.
 *
 * Резервация самого nonce вынесена в reserveNonce/releaseNonce (см. контроллер):
 * nonce фиксируется как обработанный только при успешной обработке, а при сбое
 * откатывается — иначе транзиентно упавшую доставку нельзя повторить с тем же
 * nonce (TQA-3).
 */
export const replayProtection = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const timestampHeader = req.header('X-Timestamp');
  const nonce = req.header('X-Nonce');

  const timestamp = Number(timestampHeader);
  if (!timestampHeader || !Number.isFinite(timestamp)) {
    throw new AppError(400, 'MISSING_TIMESTAMP', 'X-Timestamp header is required (unix seconds)');
  }
  if (!nonce) {
    throw new AppError(400, 'MISSING_NONCE', 'X-Nonce header is required');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > config.timestampToleranceSec) {
    throw new AppError(401, 'STALE_TIMESTAMP', 'X-Timestamp is outside the allowed window');
  }

  next();
});

/**
 * Резервирует nonce перед обработкой:
 *  - быстрый путь: атомарный SET NX в Redis с TTL;
 *  - долговечный путь: уникальный индекс WebhookEventModel.nonce в Mongo
 *    (переживает рестарт Redis).
 * Повтор уже виденного nonce -> 409.
 */
export async function reserveNonce(nonce: string, dto: WebhookDto): Promise<void> {
  const isFresh = await registerNonce(nonce, config.nonceTtlSec);
  if (!isFresh) {
    throw new AppError(409, 'DUPLICATE_NONCE', 'This nonce has already been used');
  }

  try {
    await WebhookEventModel.create({ nonce, invoiceId: dto.invoiceId, status: dto.status });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Mongo знает о nonce, а Redis — нет (например, после флуша Redis): убираем
      // только что выставленный быстрый ключ и сообщаем о повторе.
      await unregisterNonce(nonce);
      throw new AppError(409, 'DUPLICATE_NONCE', 'This nonce has already been used');
    }
    await unregisterNonce(nonce);
    throw err;
  }
}

/**
 * Откатывает резервацию nonce (Redis + Mongo), чтобы повторная доставка той же,
 * транзиентно упавшей обработки прошла заново (TQA-3).
 */
export async function releaseNonce(nonce: string): Promise<void> {
  await unregisterNonce(nonce);
  await WebhookEventModel.deleteOne({ nonce });
}
