import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { MerchantModel } from '../../src/models/merchant.model';

const app = createApp();

async function createMerchant(feePercentBps = 250) {
  const m = await MerchantModel.create({ name: 'Test', feePercentBps });
  return m._id.toString();
}

describe('POST /invoice', () => {
  it('создаёт инвойс с корректными расчётами и статусом pending', async () => {
    const merchantId = await createMerchant(250); // 2.5%

    const res = await request(app).post('/invoice').send({ amount: 10000, currency: 'usd', merchantId });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: 10000,
      currency: 'USD',
      fee: 250,
      amountToReceive: 9750,
      status: 'pending',
    });
    expect(res.body.invoiceId).toBeDefined();
  });

  it('400 при невалидном amount', async () => {
    const merchantId = await createMerchant();
    const res = await request(app).post('/invoice').send({ amount: -5, currency: 'USD', merchantId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 при несуществующем мерчанте', async () => {
    const res = await request(app)
      .post('/invoice')
      .send({ amount: 1000, currency: 'USD', merchantId: new Types.ObjectId().toString() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MERCHANT_NOT_FOUND');
  });
});

describe('GET /invoice/:id', () => {
  it('возвращает статус существующего инвойса', async () => {
    const merchantId = await createMerchant();
    const created = await request(app).post('/invoice').send({ amount: 5000, currency: 'EUR', merchantId });

    const res = await request(app).get(`/invoice/${created.body.invoiceId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('404 для отсутствующего инвойса', async () => {
    const res = await request(app).get(`/invoice/${new Types.ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });

  it('400 для невалидного id', async () => {
    const res = await request(app).get('/invoice/not-an-id');
    expect(res.status).toBe(400);
  });
});
