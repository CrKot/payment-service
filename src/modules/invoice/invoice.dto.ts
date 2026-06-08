import { z } from 'zod';
import { isValidObjectId } from 'mongoose';

export const createInvoiceSchema = z.object({
  // amount в минорных единицах (целое > 0). Ограничиваем безопасным диапазоном
  // Number: в Mongo сумма хранится как double, выше 2^53 теряется точность (TQA-4).
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().trim().length(3),
  merchantId: z.string().refine(isValidObjectId, 'merchantId must be a valid ObjectId'),
});

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
