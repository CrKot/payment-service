import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getRedis, closeRedis } from '../src/lib/redis';
import { WebhookEventModel } from '../src/models/webhookEvent.model';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // Гарантируем создание уникального индекса на nonce.
  await WebhookEventModel.init();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
  await getRedis().flushall();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  await closeRedis();
});
