import request from 'supertest';
import { randomUUID, createHmac } from 'crypto';
import { createApp } from '../../src/app';
import { MerchantModel } from '../../src/models/merchant.model';
import { InvoiceModel } from '../../src/models/invoice.model';
import { WebhookEventModel } from '../../src/models/webhookEvent.model';
import * as settlement from '../../src/modules/settlement/settlement.service';

const app = createApp();
const SECRET = 'test-secret';

/** Подпись покрывает `${timestamp}.${nonce}.${rawBody}` (TQA-2). */
function signPayload(timestamp: number, nonce: string, raw: string): string {
  return createHmac('sha256', SECRET).update(`${timestamp}.${nonce}.${raw}`).digest('hex');
}

function postWebhook(
  body: object,
  opts: { signature?: string; timestamp?: number; nonce?: string } = {},
) {
  const raw = JSON.stringify(body);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? randomUUID();
  return request(app)
    .post('/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Signature', opts.signature ?? signPayload(timestamp, nonce, raw))
    .set('X-Timestamp', String(timestamp))
    .set('X-Nonce', nonce)
    .send(raw);
}

async function createPendingInvoice() {
  const merchant = await MerchantModel.create({ name: 'M', feePercentBps: 250 });
  const invoice = await InvoiceModel.create({
    merchantId: merchant._id,
    amount: 10000,
    currency: 'USD',
    fee: 250,
    amountToReceive: 9750,
    status: 'pending',
  });
  return invoice._id.toString();
}

describe('TQA-1 (fixed) — сбой settle() не теряет зачисление', () => {
  it('settle падает -> инвойс остаётся pending, ретрай доводит зачисление ровно один раз', async () => {
    const invoiceId = await createPendingInvoice();

    // settle падает один раз (транзиентный сбой внешнего леджера/банка),
    // затем восстанавливается.
    const settleSpy = jest
      .spyOn(settlement, 'settle')
      .mockRejectedValueOnce(new Error('downstream ledger is down'));

    // 1-я доставка: settle вызывается ДО перевода в paid -> ошибка -> 500,
    // захват откатывается, инвойс НЕ помечается оплаченным.
    const first = await postWebhook({ invoiceId, status: 'paid' });
    expect(first.status).toBe(500);

    const afterFirst = await InvoiceModel.findById(invoiceId);
    expect(afterFirst?.status).toBe('pending'); // <-- не «застрял» в paid
    expect(afterFirst?.settledAt).toBeFalsy();

    // 2-я доставка (платёжка ретраит, новый nonce): settle уже работает,
    // зачисление доводится до конца.
    const second = await postWebhook({ invoiceId, status: 'paid' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'paid', settled: true, idempotent: false });

    const afterSecond = await InvoiceModel.findById(invoiceId);
    expect(afterSecond?.status).toBe('paid');
    expect(afterSecond?.settledAt).toBeTruthy();

    // Успешное зачисление произошло ровно один раз (1 провал + 1 успех вызова settle).
    expect(settleSpy).toHaveBeenCalledTimes(2);
  });
});

describe('TQA-2 (fixed) — подпись привязана к timestamp и nonce', () => {
  it('перехваченную подпись нельзя переотправить с другим nonce -> 401', async () => {
    const invoiceId = await createPendingInvoice();
    const raw = JSON.stringify({ invoiceId, status: 'paid' });
    const ts = Math.floor(Date.now() / 1000);

    // «Перехваченная» валидная подпись для конкретных ts+nonce.
    const capturedSig = signPayload(ts, 'original-nonce', raw);

    // Легитимный запрос с теми же ts+nonce проходит.
    const ok = await postWebhook(
      { invoiceId, status: 'paid' },
      { signature: capturedSig, timestamp: ts, nonce: 'original-nonce' },
    );
    expect(ok.status).toBe(200);

    // Атакующий переотправляет ту же подпись, но со СВОИМ nonce -> подпись инвалидна.
    const replayNewNonce = await postWebhook(
      { invoiceId, status: 'paid' },
      { signature: capturedSig, timestamp: ts, nonce: 'attacker-nonce' },
    );
    expect(replayNewNonce.status).toBe(401);
    expect(replayNewNonce.body.error.code).toBe('INVALID_SIGNATURE');

    // ...и с подменённым timestamp -> тоже 401.
    const replayNewTs = await postWebhook(
      { invoiceId, status: 'paid' },
      { signature: capturedSig, timestamp: ts + 1, nonce: 'original-nonce' },
    );
    expect(replayNewTs.status).toBe(401);
    expect(replayNewTs.body.error.code).toBe('INVALID_SIGNATURE');
  });
});

describe('TQA-3 (fixed) — nonce откатывается при сбое обработки', () => {
  it('транзиентно упавшую доставку можно повторить с ТЕМ ЖЕ nonce и довести до конца', async () => {
    const invoiceId = await createPendingInvoice();
    const nonce = randomUUID();

    // settle падает один раз, затем восстанавливается.
    const settleSpy = jest
      .spyOn(settlement, 'settle')
      .mockRejectedValueOnce(new Error('downstream ledger is down'));

    // 1-я доставка падает (500); резервация nonce откатывается.
    const first = await postWebhook({ invoiceId, status: 'paid' }, { nonce });
    expect(first.status).toBe(500);

    // Ретрай ТОЙ ЖЕ доставки с ТЕМ ЖЕ nonce больше не отвергается как повтор:
    // nonce был освобождён, обработка доходит и зачисляет.
    const retry = await postWebhook({ invoiceId, status: 'paid' }, { nonce });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: 'paid', settled: true, idempotent: false });
    expect(settleSpy).toHaveBeenCalledTimes(2); // 1 провал + 1 успех
  });

  it('успешно обработанный nonce повторно использовать нельзя (409)', async () => {
    const invoiceId = await createPendingInvoice();
    const nonce = randomUUID();

    const first = await postWebhook({ invoiceId, status: 'paid' }, { nonce });
    expect(first.status).toBe(200);

    // Тот же nonce после успеха -> остаётся зарезервированным -> 409.
    const replay = await postWebhook({ invoiceId, status: 'paid' }, { nonce });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('DUPLICATE_NONCE');
  });
});

describe('QA — позитив: терминальный статус нельзя переписать', () => {
  it('failed -> paid невозможен (no-op, без зачисления)', async () => {
    const settleSpy = jest.spyOn(settlement, 'settle');
    const invoiceId = await createPendingInvoice();

    const failed = await postWebhook({ invoiceId, status: 'failed' });
    expect(failed.body.status).toBe('failed');

    const tryPaid = await postWebhook({ invoiceId, status: 'paid' });
    expect(tryPaid.status).toBe(200);
    expect(tryPaid.body).toMatchObject({ status: 'failed', settled: false, idempotent: true });
    expect(settleSpy).not.toHaveBeenCalled();
  });
});

describe('QA — крайние значения сумм', () => {
  it('amount = 1 минорная единица: fee floor -> 0, к зачислению 1', async () => {
    const merchant = await MerchantModel.create({ name: 'M', feePercentBps: 250 });
    const res = await request(app)
      .post('/invoice')
      .send({ amount: 1, currency: 'USD', merchantId: merchant._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ fee: 0, amountToReceive: 1 });
  });

  it('amount = 0 отвергается (positive)', async () => {
    const merchant = await MerchantModel.create({ name: 'M', feePercentBps: 250 });
    const res = await request(app)
      .post('/invoice')
      .send({ amount: 0, currency: 'USD', merchantId: merchant._id.toString() });
    expect(res.status).toBe(400);
  });

  it('amount нецелый (float) отвергается', async () => {
    const merchant = await MerchantModel.create({ name: 'M', feePercentBps: 250 });
    const res = await request(app)
      .post('/invoice')
      .send({ amount: 100.5, currency: 'USD', merchantId: merchant._id.toString() });
    expect(res.status).toBe(400);
  });

  it('amount выше MAX_SAFE_INTEGER отвергается (TQA-4)', async () => {
    const merchant = await MerchantModel.create({ name: 'M', feePercentBps: 250 });
    const res = await request(app)
      .post('/invoice')
      .send({ amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD', merchantId: merchant._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('TQA-6 — TTL-индекс на WebhookEvent', () => {
  it('есть TTL-индекс по receivedAt с expireAfterSeconds', async () => {
    const indexes = await WebhookEventModel.collection.indexes();
    const ttl = indexes.find(
      (i) => i.key?.receivedAt === 1 && typeof i.expireAfterSeconds === 'number',
    );
    expect(ttl).toBeDefined();
  });
});
