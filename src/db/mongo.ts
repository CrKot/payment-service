import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../lib/logger';

export async function connectMongo(uri: string = config.mongoUri): Promise<void> {
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
