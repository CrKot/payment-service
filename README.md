# Payment Service

Сервис приёма платежей: создание счетов (invoice) с расчётом комиссии и приём
вебхуков о статусе оплаты с проверкой подписи, защитой от повторов и
**идемпотентным зачислением — ровно один раз**.

Стек: **Node.js + Express + TypeScript**, **MongoDB (Mongoose)**, **Redis**, тесты — **Jest**.

---

## Запуск

Нужны локально запущенные **MongoDB** и **Redis** (по условию задания без Docker).

```bash
# 1. зависимости
npm install

# 2. конфигурация
cp .env.example .env        # при необходимости поправьте значения

# 3. тестовый мерчант (выведет MERCHANT_ID для запросов)
npm run seed

# 4. запуск в dev-режиме
npm run dev                 # http://localhost:3000

# прод-сборка
npm run build && npm start
```

Проверка живости: `GET /health` → `{ "status": "ok" }`.

## Тесты

```bash
npm test
```

Тестам **не нужны** внешние MongoDB/Redis: используется `mongodb-memory-server`
(in-memory Mongo) и `ioredis-mock`. Покрыто:

- расчёт комиссии (`tests/unit/money.test.ts`);
- HMAC-подпись (`tests/unit/hmac.test.ts`);
- атомарность распределённого лока (`tests/unit/redis.test.ts`);
- создание/чтение инвойса (`tests/integration/invoice.test.ts`);
- безопасность и идемпотентность вебхука, включая **конкурентную доставку**
  (`tests/integration/webhook.test.ts`);
- крайние/состязательные сценарии: сбой `settle()` с ретраем, replay перехваченной
  подписи, освобождение nonce при сбое, границы сумм, TTL-журнала
  (`tests/integration/qa-adversarial.test.ts`).

---

## API

### `POST /invoice`
Тело:
```json
{ "amount": 10000, "currency": "USD", "merchantId": "<ObjectId>" }
```
- `fee = amount × feePercent` (feePercent — из настроек мерчанта);
- `amountToReceive = amount − fee`;
- сохраняется со статусом `pending`.

Ответ `201`:
```json
{
  "invoiceId": "...", "merchantId": "...",
  "amount": 10000, "currency": "USD",
  "fee": 250, "amountToReceive": 9750,
  "status": "pending", "settledAt": null
}
```

### `POST /webhook`
Заголовки:
- `X-Signature` — `HMAC-SHA256(secret, "<X-Timestamp>.<X-Nonce>." + raw body)`, hex;
- `X-Timestamp` — unix-время в **секундах** (проверка свежести);
- `X-Nonce` — уникальная строка (защита от повтора).

Подпись покрывает timestamp и nonce, а не только тело: иначе перехваченную подпись
можно переотправить с подменёнными заголовками.

Тело: `{ "invoiceId": "...", "status": "paid" | "failed" }`.

Поведение:
- невалидная подпись → `401`;
- устаревший timestamp → `401`;
- повторный nonce → `409`;
- `paid` переводит инвойс в `paid` и выполняет зачисление **ровно один раз**;
- повторная доставка того же события → `200` (no-op, `idempotent: true`).

Пример вызова:
```bash
BODY='{"invoiceId":"<id>","status":"paid"}'
SECRET='super-secret-change-me'   # = WEBHOOK_HMAC_SECRET из .env
TS=$(date +%s)
NONCE=$(uuidgen)
# Подпись считается от "<timestamp>.<nonce>." + тело.
SIG=$(printf '%s' "$TS.$NONCE.$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -H "X-Timestamp: $TS" \
  -H "X-Nonce: $NONCE" \
  -d "$BODY"
```

### `GET /invoice/:id`
Возвращает текущее состояние инвойса (`404`, если не найден).

---

## Ключевые инженерные решения

**Точность денег.** Все суммы — целые в **минорных единицах** (копейки/центы).
Комиссия считается через `BigInt`, без `float` (см. `src/lib/money.ts`).

**Подпись.** HMAC считается от строки `"<X-Timestamp>.<X-Nonce>."` + **сырые байты** тела
(захват тела в `src/middlewares/rawBody.ts`), а не от пересериализованного JSON. Привязка к
timestamp/nonce не даёт переотправить перехваченную подпись с подменёнными заголовками.
Сравнение — `crypto.timingSafeEqual`.

**Защита от повторов.** `X-Timestamp` в окне допустимой свежести + одноразовый
`X-Nonce`: быстрый путь — атомарный `SET NX` в Redis с TTL; долговечный —
уникальный индекс `WebhookEvent.nonce` в Mongo (переживает рестарт Redis). Nonce
**резервируется** перед обработкой и **освобождается при сбое**: транзиентно упавшую
доставку можно повторить с тем же nonce и довести до конца, тогда как успешно
обработанный nonce остаётся durable-зарезервированным (повтор → `409`). Журнал
`WebhookEvent` чистится TTL-индексом по `receivedAt`, чтобы не рос бесконечно.

**Идемпотентность и надёжность зачисления (ядро).** Зачисление «захватывается»
**атомарным условным апдейтом** `findOneAndUpdate({ _id, status: 'pending',
settleInProgress: { $ne: true } }, { settleInProgress: true })` — захватить инвойс
может только один обработчик, поэтому заглушка `settle()` для `paid` вызывается не
более одного раза. При этом `settle()` выполняется **до** перевода в `paid`: только
после его успеха инвойс становится `paid`, а при сбое флаг откатывается и статус
остаётся `pending`, так что повторная доставка доводит зачисление до конца (деньги
не «теряются» при оплаченном статусе). Дополнительно конкурентные вебхуки по одному
`invoiceId` сериализуются Redis-локом. Барьер проверяется тестом с 5 одновременными
вебхуками (единственное зачисление) и тестом на сбой `settle()` с последующим ретраем.

---

## Принятые допущения

1. **`amount` приходит в минорных единицах** (целое > 0), например `10000` = `100.00`.
2. **`feePercent` хранится в базисных пунктах** (`feePercentBps`): `250` = `2.5%`.
3. **Округление комиссии — вниз (floor)**, одинаково во всех расчётах.
4. **`merchantId` = `_id` мерчанта** (ObjectId); регистрация мерчантов вне задания,
   тестовый мерчант создаётся через `npm run seed`.
5. **`X-Timestamp` — в секундах**; окно свежести и TTL nonce настраиваются в `.env`
   (`NONCE_TTL_SEC` ≥ окна timestamp).
6. **Зачисление — заглушка** (`src/modules/settlement/settlement.service.ts`):
   реальная интеграция с платёжной системой по условию не требуется.
7. Подпись считается от строки `timestamp.nonce.body`, поэтому подмена заголовков
   ломает подпись (перехваченный запрос нельзя переотправить с новым nonce/timestamp).

## Что доделал бы при наличии времени

- **Идемпотентность `POST /invoice`** через ключ идемпотентности от клиента.
- **OpenAPI-спека** и больше негативных тестов (битый JSON, отсутствие заголовков).
- **ESLint/Prettier** в CI и метрики/health для Mongo/Redis.

---

## Структура

```
src/
├── app.ts / server.ts        # сборка Express / bootstrap
├── config/                   # валидация env (zod)
├── lib/                      # money, hmac, redis (nonce+lock), errors, logger
├── models/                   # Merchant, Invoice, WebhookEvent
├── middlewares/              # rawBody, validate, errorHandler
├── modules/
│   ├── invoice/              # POST /invoice, GET /invoice/:id
│   ├── webhook/              # подпись, replay, идемпотентное зачисление
│   └── settlement/           # заглушка зачисления
└── db/                       # подключение Mongo, seed
tests/                        # unit + integration
```

Документы планирования: [STACK.md](STACK.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](TASKS.md).
