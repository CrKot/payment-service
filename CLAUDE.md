# CLAUDE.md — контекст проекта payment-service

## Что это
Тестовое задание для позиции **Backend-разработчик (Node.js)**. Источник ТЗ —
Google Doc (id `1L4rSV8EwTrtWerPrv6QEHpqAmjhyYzMpZ8Dfd9fHo78`, документ публичный,
читается через export `?format=txt`). Полный текст ТЗ зафиксирован в этом файле ниже.

## Статус: РЕАЛИЗАЦИЯ ЗАВЕРШЕНА И ПРОТЕСТИРОВАНА
- Все эндпоинты, безопасность и идемпотентность реализованы.
- `npm test` → **26 тестов зелёные** (4 suite). `npm run build` → чисто.
- Git ещё НЕ инициализирован (пользователь создаст репозиторий сам позже).
- Документы планирования: README.md (рабочий, для сдачи), STACK.md, ROADMAP.md, TASKS.md.

## ТЗ (суть)
Сервис приёма платежей. Три эндпоинта:
- `POST /invoice` — вход `amount`, `currency`, `merchantId`; `fee = amount × feePercent`
  (feePercent из настроек мерчанта); `amountToReceive = amount − fee`; статус `pending`;
  вернуть `invoiceId` и суммы.
- `POST /webhook` — заголовки `X-Signature` (HMAC-SHA256 от тела), `X-Timestamp`, `X-Nonce`;
  тело `{ invoiceId, status }` (`paid|failed`); проверить подпись, свежесть времени,
  уникальность nonce; при `paid` зачисление **ровно один раз** даже при повторе.
- `GET /invoice/:id` — текущий статус.
- Тесты минимум: подпись, идемпотентность webhook, расчёт комиссии.

Стек по ТЗ: Node.js + Express, MongoDB (Mongoose), Redis, тесты (Jest/Mocha), TS опционально.

**Что НЕ нужно делать (важно!):** реальную интеграцию с платёжкой (только заглушки);
аутентификацию/регистрацию; **Docker, CI/CD, деплой**. Эти исключения держим ТОЛЬКО в
рабочих контекстах (STACK/ROADMAP/TASKS/этот файл), в README проекта их НЕ упоминаем
(README — только то, что по ТЗ). Сроки и контакты в ТЗ оставлены пустыми.

Оценивают: точность денег, безопасность (подпись + replay), конкурентность, читаемость, тесты.

## Реализация — как устроено (ключевое)
- **TypeScript + Express**. `src/app.ts` собирает app (без listen, для тестов),
  `src/server.ts` — bootstrap (connect Mongo + listen).
- **Деньги**: целые минорные единицы, расчёт через BigInt, округление вниз — `src/lib/money.ts`.
  feePercent хранится в basis points (`feePercentBps`, 250 = 2.5%).
- **HMAC**: от `${X-Timestamp}.${X-Nonce}.` + сырые байты тела (TQA-2: подпись покрывает
  timestamp и nonce, не только тело — `buildSigningPayload` в signature.middleware). rawBody —
  `src/middlewares/rawBody.ts` через `express.json({verify})`; сравнение `timingSafeEqual` —
  `src/lib/hmac.ts`, мидлвара `modules/webhook/signature.middleware.ts`.
- **Replay**: `replayProtection` мидлвара — только свежесть timestamp + присутствие nonce
  (без записи). Резервация nonce вынесена в `reserveNonce`/`releaseNonce` (Redis `SET NX EX` +
  unique-индекс `WebhookEvent.nonce` в Mongo); контроллер резервирует nonce, обрабатывает и
  при сбое откатывает резервацию (TQA-3) — `modules/webhook/replay.middleware.ts`,
  `webhook.controller.ts`, `lib/redis.ts` (registerNonce/unregisterNonce, acquireLock/releaseLock
  через Lua-eval/withLock). TTL-индекс на `WebhookEvent.receivedAt` чистит журнал (TQA-6).
- **Идемпотентность + надёжность зачисления (ядро)**: в `processPaid` (webhook.service)
  атомарный «захват» `findOneAndUpdate({_id, status:'pending', settleInProgress:{$ne:true}},
  {settleInProgress:true})` → settle() ровно один раз; settle вызывается ДО перевода в `paid`,
  при сбое флаг `settleInProgress` откатывается, статус остаётся `pending` → ретрай доводит
  зачисление (TQA-1). В `paid` переводим только после успеха settle. `failed` — отдельный
  атомарный переход pending→failed. Плюс Redis-lock по invoiceId (withLock) для сериализации.
- **Settlement** — заглушка: `modules/settlement/settlement.service.ts` (logger).
- Порядок мидлвар вебхука: verifySignature → validateBody → replayProtection → handle.
- Ошибки: AppError + errorHandler, формат `{ error: { code, message } }`.

## Тесты
- `jest.config.js`: `moduleNameMapper` подменяет `ioredis` → `ioredis-mock`;
  `setupFiles: tests/env.ts` (env), `setupFilesAfterEnv: tests/setup.ts`
  (mongodb-memory-server + очистка между тестами).
- Webhook-тест проверяет в т.ч. 5 конкурентных вебхуков → ровно одно зачисление
  (spy на `settlement.settle` через `import * as settlement`).

## Команды
- `npm install`, `npm test`, `npm run build`, `npm run dev`, `npm run seed` (создаёт мерчанта, печатает MERCHANT_ID).
- Env обязателен: `WEBHOOK_HMAC_SECRET`. См. `.env.example`.

## QA-прогон и фиксы (см. TASKS.md → раздел TQA)
- Адверсариальные тесты: `tests/integration/qa-adversarial.test.ts` + `tests/unit/redis.test.ts`.
  `npm test` → **38 зелёных** (6 suite). Все TQA-1…TQA-6 закрыты.
- ✅ TQA-1 (CRITICAL): сбой settle больше не теряет деньги (settleInProgress + settle до коммита).
- ✅ TQA-2 (CRITICAL): подпись привязана к timestamp+nonce, replay перехвата → 401.
- ✅ TQA-3 (HIGH): nonce резервируется и откатывается при сбое → ретрай с тем же nonce доходит.
- ✅ TQA-4 (MED): `amount` ограничен `MAX_SAFE_INTEGER` (точность хранения в Mongo).
- ✅ TQA-5 (MED): `releaseLock` атомарен через Lua-`eval`.
- ✅ TQA-6 (LOW): TTL-индекс на `WebhookEvent.receivedAt` (`expireAfterSeconds = nonceTtlSec`).

## Известные допущения / что доделать (в README → разделы «Допущения» и «Что доделал бы»)
- amount в минорных единицах; X-Timestamp в секундах; merchantId = ObjectId.
- Подпись = HMAC от `timestamp.nonce.body` (после TQA-2).
- TODO-идеи (осталось): идемпотентность POST /invoice, OpenAPI, ESLint/Prettier.
