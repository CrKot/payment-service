import { createHmac, timingSafeEqual } from 'crypto';

/** Считает HMAC-SHA256 от тела запроса, hex. */
export function sign(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Сравнивает ожидаемую подпись с присланной в постоянное время
 * (защита от timing-атак). Возвращает false при несовпадении длины/значения.
 */
export function verify(rawBody: Buffer | string, secret: string, signature: string | undefined): boolean {
  if (!signature) return false;

  const expected = Buffer.from(sign(rawBody, secret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
