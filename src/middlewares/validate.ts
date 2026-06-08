import type { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../lib/errors';

/** Валидирует req.body по zod-схеме; при ошибке -> 400 с деталями. */
export const validateBody = (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return next(new AppError(400, 'VALIDATION_ERROR', details));
  }
  req.body = result.data;
  next();
};
