import { Schema, model, InferSchemaType } from 'mongoose';
import { config } from '../config';

/**
 * Журнал принятых вебхуков. Уникальный индекс на nonce — ДОЛГОВЕЧНАЯ защита
 * от повторов на случай, если Redis был очищен/перезапущен (в Redis nonce
 * хранится с TTL как быстрый путь).
 *
 * TTL-индекс на receivedAt чистит журнал автоматически (TQA-6): запись живёт
 * столько же, сколько nonce в Redis (nonceTtlSec). Дольше держать незачем —
 * запрос со старым timestamp всё равно отсекается проверкой свежести.
 */
const webhookEventSchema = new Schema(
  {
    nonce: { type: String, required: true, unique: true },
    invoiceId: { type: String, default: null },
    status: { type: String, default: null },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: config.nonceTtlSec });

export type WebhookEvent = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEventModel = model('WebhookEvent', webhookEventSchema);
