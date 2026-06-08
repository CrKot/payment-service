// Выполняется до загрузки кода приложения (setupFiles) — задаёт окружение для тестов.
process.env.NODE_ENV = 'test';
process.env.WEBHOOK_HMAC_SECRET = 'test-secret';
process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SEC = '300';
process.env.NONCE_TTL_SEC = '600';
