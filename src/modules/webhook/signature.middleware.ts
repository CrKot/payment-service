import type { Request, Response, NextFunction } from 'express';
import { verify } from '../../lib/hmac';
import { config } from '../../config';
import { AppError } from '../../lib/errors';

/**
 * Каноничные байты для подписи: `${timestamp}.${nonce}.` + сырое тело.
 * Подпись покрывает timestamp и nonce, а не только тело, — иначе перехваченную
 * подпись можно переотправить с подменёнными nonce/timestamp (см. TQA-2).
 */
export function buildSigningPayload(timestamp: string, nonce: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.${nonce}.`, 'utf8'), rawBody]);
}

/**
 * Проверяет X-Signature = HMAC-SHA256(secret, `${X-Timestamp}.${X-Nonce}.` + rawBody).
 * Невалидная/отсутствующая подпись -> 401, без каких-либо побочных эффектов.
 * Привязка к timestamp/nonce закрывает replay перехваченного запроса: подменить
 * заголовки, не сломав подпись, нельзя.
 */
export function verifySignature(req: Request, _res: Response, next: NextFunction) {
  const signature = req.header('X-Signature');
  const timestamp = req.header('X-Timestamp') ?? '';
  const nonce = req.header('X-Nonce') ?? '';
  const rawBody = req.rawBody ?? Buffer.alloc(0);

  const payload = buildSigningPayload(timestamp, nonce, rawBody);
  if (!verify(payload, config.hmacSecret, signature)) {
    return next(new AppError(401, 'INVALID_SIGNATURE', 'Invalid or missing X-Signature'));
  }
  next();
}
