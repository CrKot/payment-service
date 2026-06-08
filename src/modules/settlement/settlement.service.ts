import type { Invoice } from '../../models/invoice.model';
import { logger } from '../../lib/logger';

/**
 * ЗАГЛУШКА зачисления средств мерчанту.
 * По условию реальная интеграция с платёжной системой не требуется — здесь
 * был бы вызов леджера/банковского API. Гарантируется, что для одного инвойса
 * этот метод вызовется РОВНО ОДИН РАЗ (см. webhook.service: атомарный переход
 * статуса pending -> paid выполняется единожды).
 */
export async function settle(invoice: Invoice): Promise<void> {
  logger.info(
    { invoiceId: invoice._id.toString(), amountToReceive: invoice.amountToReceive, currency: invoice.currency },
    'Settlement executed (stub)',
  );
}
