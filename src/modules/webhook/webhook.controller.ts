import type { Request, Response } from 'express';
import * as webhookService from './webhook.service';
import { reserveNonce, releaseNonce } from './replay.middleware';

export async function handle(req: Request, res: Response) {
  // X-Nonce присутствие/свежесть timestamp уже проверены replayProtection.
  const nonce = req.header('X-Nonce') as string;

  // Резервируем nonce, обрабатываем, и при сбое откатываем резервацию — тогда
  // транзиентно упавшую доставку можно повторить с тем же nonce (TQA-3).
  await reserveNonce(nonce, req.body);
  try {
    const result = await webhookService.processWebhook(req.body);
    res.status(200).json(result);
  } catch (err) {
    await releaseNonce(nonce);
    throw err;
  }
}
