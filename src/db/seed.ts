import { connectMongo, disconnectMongo } from './mongo';
import { MerchantModel } from '../models/merchant.model';
import { logger } from '../lib/logger';

/** Создаёт тестового мерчанта и печатает его id для ручной проверки API. */
async function seed() {
  await connectMongo();

  const merchant = await MerchantModel.create({
    name: 'Demo Merchant',
    feePercentBps: 250, // 2.5%
  });

  logger.info(`Seeded merchant: ${merchant._id.toString()} (feePercentBps=${merchant.feePercentBps})`);
  // Печатаем явно в stdout, т.к. логгер может быть приглушён.
  process.stdout.write(`MERCHANT_ID=${merchant._id.toString()}\n`);

  await disconnectMongo();
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
