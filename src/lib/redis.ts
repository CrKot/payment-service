import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { config } from '../config';

let client: Redis | null = null;

/** Ленивый singleton-клиент Redis. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

/**
 * Регистрирует nonce. Возвращает true, если nonce увиден впервые (атомарный SET NX).
 * false — значит запрос с таким nonce уже приходил (replay).
 */
export async function registerNonce(nonce: string, ttlSec: number): Promise<boolean> {
  const res = await getRedis().set(`nonce:${nonce}`, '1', 'EX', ttlSec, 'NX');
  return res === 'OK';
}

/**
 * Снимает резервацию nonce (откат). Нужен, чтобы обработка, упавшая транзиентно,
 * могла быть повторена с тем же nonce — см. TQA-3.
 */
export async function unregisterNonce(nonce: string): Promise<void> {
  await getRedis().del(`nonce:${nonce}`);
}

/**
 * Пытается захватить распределённую блокировку по ключу.
 * Возвращает токен владельца или null, если блокировка занята.
 */
export async function acquireLock(key: string, ttlSec: number): Promise<string | null> {
  const token = randomUUID();
  const res = await getRedis().set(`lock:${key}`, token, 'EX', ttlSec, 'NX');
  return res === 'OK' ? token : null;
}

// Атомарная проверка-и-удаление: снять лок можно, только если токен совпадает.
// get+del двумя командами — гонка (можно снять чужой лок между ними), поэтому Lua (TQA-5).
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** Освобождает блокировку только если токен совпадает (чтобы не снять чужой лок). */
export async function releaseLock(key: string, token: string): Promise<void> {
  await getRedis().eval(RELEASE_LOCK_SCRIPT, 1, `lock:${key}`, token);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Захватывает блокировку с повторными попытками, выполняет fn под ней и гарантированно
 * освобождает. Если за отведённое время лок не получен — бросает onTimeout().
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttlSec?: number; retries?: number; delayMs?: number; onTimeout: () => never } = {
    onTimeout: () => {
      throw new Error('lock timeout');
    },
  },
): Promise<T> {
  const { ttlSec = 10, retries = 50, delayMs = 50, onTimeout } = opts;

  let token: string | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    token = await acquireLock(key, ttlSec);
    if (token) break;
    await sleep(delayMs);
  }
  if (token === null) {
    onTimeout();
    throw new Error('lock acquisition timeout'); // недостижимо: onTimeout всегда бросает
  }

  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}
