import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { validateBody } from '../../middlewares/validate';
import { verifySignature } from './signature.middleware';
import { replayProtection } from './replay.middleware';
import { webhookSchema } from './webhook.dto';
import * as controller from './webhook.controller';

export const webhookRouter = Router();

// Порядок важен: сначала подпись (от сырого тела), затем валидация структуры,
// затем защита от повторов (nonce/timestamp), и только потом бизнес-логика.
webhookRouter.post(
  '/',
  verifySignature,
  validateBody(webhookSchema),
  replayProtection,
  asyncHandler(controller.handle),
);
