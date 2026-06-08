import { InvoiceModel } from '../../models/invoice.model';
import { withLock } from '../../lib/redis';
import { AppError } from '../../lib/errors';
import * as settlement from '../settlement/settlement.service';
import type { WebhookDto } from './webhook.dto';

export interface WebhookResult {
  invoiceId: string;
  status: string;
  settled: boolean;
  idempotent: boolean;
}

/**
 * Зачисление по статусу paid.
 *
 *   1. АТОМАРНЫЙ «захват»: findOneAndUpdate({_id, status:'pending', settleInProgress:false},
 *      {settleInProgress:true}). Захватить инвойс может только один обработчик — значит
 *      settle() выполнится не более одного раза даже при гонках и повторных доставках.
 *   2. settle() вызывается ДО перевода в терминальный статус. Только после его успеха
 *      инвойс переходит в paid (settledAt, settleInProgress:false). Если settle падает —
 *      флаг откатывается, статус остаётся pending, и повторная доставка доведёт зачисление
 *      до конца (см. TQA-1: иначе инвойс «оплачен», но деньги фактически потеряны).
 */
async function processPaid(invoiceId: string): Promise<WebhookResult> {
  const claimed = await InvoiceModel.findOneAndUpdate(
    { _id: invoiceId, status: 'pending', settleInProgress: { $ne: true } },
    { $set: { settleInProgress: true } },
    { new: true },
  );

  // Захват не получен: либо уже терминальный статус (идемпотентный no-op),
  // либо кто-то держит захват (при живом Redis-локе сюда обычно не доходим).
  if (!claimed) {
    const current = await InvoiceModel.findById(invoiceId);
    if (current?.settleInProgress) {
      throw new AppError(409, 'PROCESSING_IN_PROGRESS', 'Settlement for this invoice is in progress');
    }
    return { invoiceId, status: current?.status ?? 'unknown', settled: false, idempotent: true };
  }

  try {
    await settlement.settle(claimed);
  } catch (err) {
    // Откатываем захват, чтобы повторная доставка могла довести зачисление.
    await InvoiceModel.updateOne({ _id: invoiceId }, { $set: { settleInProgress: false } });
    throw err;
  }

  await InvoiceModel.updateOne(
    { _id: invoiceId },
    { $set: { status: 'paid', settledAt: new Date(), settleInProgress: false } },
  );

  return { invoiceId, status: 'paid', settled: true, idempotent: false };
}

/**
 * Обрабатывает статус вебхука. Redis-lock по invoiceId сериализует конкурентные
 * вебхуки (belt-and-suspenders); durable-гарантию однократного зачисления даёт
 * атомарный захват в Mongo внутри processPaid.
 */
export async function processWebhook(dto: WebhookDto): Promise<WebhookResult> {
  const { invoiceId, status } = dto;

  return withLock<WebhookResult>(
    invoiceId,
    async () => {
      const existing = await InvoiceModel.findById(invoiceId);
      if (!existing) {
        throw new AppError(404, 'INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found`);
      }

      if (status === 'paid') {
        return processPaid(invoiceId);
      }

      // status === 'failed': атомарный однократный переход pending -> failed.
      const updated = await InvoiceModel.findOneAndUpdate(
        { _id: invoiceId, status: 'pending' },
        { $set: { status: 'failed', settledAt: null } },
        { new: true },
      );
      if (!updated) {
        return { invoiceId, status: existing.status, settled: false, idempotent: true };
      }
      return { invoiceId, status: 'failed', settled: false, idempotent: false };
    },
    {
      ttlSec: 10,
      onTimeout: () => {
        throw new AppError(409, 'PROCESSING_IN_PROGRESS', 'Webhook for this invoice is being processed');
      },
    },
  );
}
