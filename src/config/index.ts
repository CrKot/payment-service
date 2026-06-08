import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1).default('mongodb://localhost:27017/payments'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  // Секрет обязателен: без него подпись вебхука нечем проверять.
  WEBHOOK_HMAC_SECRET: z.string().min(1, 'WEBHOOK_HMAC_SECRET is required'),
  WEBHOOK_TIMESTAMP_TOLERANCE_SEC: z.coerce.number().int().positive().default(300),
  NONCE_TTL_SEC: z.coerce.number().int().positive().default(600),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Падаем сразу при старте, а не во время обработки запросов.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  redisUrl: env.REDIS_URL,
  hmacSecret: env.WEBHOOK_HMAC_SECRET,
  timestampToleranceSec: env.WEBHOOK_TIMESTAMP_TOLERANCE_SEC,
  nonceTtlSec: env.NONCE_TTL_SEC,
} as const;
