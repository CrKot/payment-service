import { z } from 'zod';
import { isValidObjectId } from 'mongoose';

export const webhookSchema = z.object({
  invoiceId: z.string().refine(isValidObjectId, 'invoiceId must be a valid ObjectId'),
  status: z.enum(['paid', 'failed']),
});

export type WebhookDto = z.infer<typeof webhookSchema>;
