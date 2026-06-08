/**
 * Прикладная ошибка с HTTP-кодом и машинным кодом.
 * Бросается из сервисов/мидлвар, превращается в JSON-ответ в errorHandler.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}
