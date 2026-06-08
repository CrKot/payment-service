import request from 'supertest';
import { randomUUID, createHmac } from 'crypto';
import { createApp } from '../../src/app';
import { MerchantModel } from '../../src/models/merchant.model';
import { InvoiceModel } from '../../src/models/invoice.model';
import * as settlement from '../../src/modules/settlement/settlement.service';

const app = createApp();
const SECRET = 'test-secret';

/** Подпись покрывает `${timestamp}.${nonce}.${rawBody}` (TQA-2). */
function signPayload(timestamp: number, nonce: string, raw: string): string {
  return createHmac('sha256', SECRET).update(`${timestamp}.${nonce}.${raw}`).digest('hex');
}

interface WebhookOpts {
  signature?: string;
  timestamp?: number;
  nonce?: string;
}

/** Отправляет webhook с валидной подписью; отдельные заголовки можно переопределить. */
function postWebhook(body: object, opts: WebhookOpts = {}) {
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

describe('POST /webhook — безопасность', () => {
  it('200 при валидной подписи и переводит инвойс в paid', async () => {
    const invoiceId = await createPendingInvoice();
    const res = await postWebhook({ invoiceId, status: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', settled: true, idempotent: false });

    const invoice = await InvoiceModel.findById(invoiceId);
    expect(invoice?.status).toBe('paid');
    expect(invoice?.settledAt).toBeTruthy();
  });

  it('401 при неверной подписи (без побочных эффектов)', async () => {
    const invoiceId = await createPendingInvoice();
    const res = await postWebhook({ invoiceId, status: 'paid' }, { signature: 'deadbeef' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    const invoice = await InvoiceModel.findById(invoiceId);
    expect(invoice?.status).toBe('pending');
  });

  it('401 при устаревшем X-Timestamp', async () => {
    const invoiceId = await createPendingInvoice();
    const stale = Math.floor(Date.now() / 1000) - 10_000;
    const res = await postWebhook({ invoiceId, status: 'paid' }, { timestamp: stale });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('STALE_TIMESTAMP');
  });
});

describe('POST /webhook — идемпотентность', () => {
  it('повтор с тем же nonce -> 409, зачисление один раз', async () => {
    const settleSpy = jest.spyOn(settlement, 'settle');
    const invoiceId = await createPendingInvoice();
    const nonce = randomUUID();

    const first = await postWebhook({ invoiceId, status: 'paid' }, { nonce });
    const second = await postWebhook({ invoiceId, status: 'paid' }, { nonce });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_NONCE');
    expect(settleSpy).toHaveBeenCalledTimes(1);
  });

  it('повторная доставка с другим nonce -> no-op, зачисление один раз', async () => {
    const settleSpy = jest.spyOn(settlement, 'settle');
    const invoiceId = await createPendingInvoice();

    const first = await postWebhook({ invoiceId, status: 'paid' });
    const second = await postWebhook({ invoiceId, status: 'paid' });

    expect(first.body).toMatchObject({ settled: true, idempotent: false });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'paid', settled: false, idempotent: true });
    expect(settleSpy).toHaveBeenCalledTimes(1);
  });

  it('N конкурентных вебхуков (разные nonce) -> ровно одно зачисление', async () => {
    const settleSpy = jest.spyOn(settlement, 'settle');
    const invoiceId = await createPendingInvoice();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => postWebhook({ invoiceId, status: 'paid' })),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.settled === true)).toHaveLength(1);
    expect(settleSpy).toHaveBeenCalledTimes(1);

    const invoice = await InvoiceModel.findById(invoiceId);
    expect(invoice?.status).toBe('paid');
  });

  it('status failed -> статус failed, без зачисления', async () => {
    const settleSpy = jest.spyOn(settlement, 'settle');
    const invoiceId = await createPendingInvoice();

    const res = await postWebhook({ invoiceId, status: 'failed' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'failed', settled: false });
    expect(settleSpy).not.toHaveBeenCalled();

    const invoice = await InvoiceModel.findById(invoiceId);
    expect(invoice?.status).toBe('failed');
    expect(invoice?.settledAt).toBeFalsy();
  });

  it('404 для несуществующего инвойса', async () => {
    const fakeId = '0123456789abcdef01234567';
    const res = await postWebhook({ invoiceId: fakeId, status: 'paid' });
    expect(res.status).toBe(404);
  });
});
