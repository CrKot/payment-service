import express from 'express';
import type { Request } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    // Сырые байты тела — нужны для проверки HMAC-подписи до доверия к JSON.
    rawBody?: Buffer;
  }
}

/**
 * JSON-парсер, который попутно сохраняет сырое тело запроса в req.rawBody.
 * Подпись считается именно от этих байт, а не от пересериализованного объекта.
 */
export const jsonWithRawBody = express.json({
  verify: (req: Request, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
});
