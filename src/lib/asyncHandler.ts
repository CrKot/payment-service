import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Оборачивает async-обработчик, чтобы отклонённые промисы уходили в next(err). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
