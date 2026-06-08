# План реализации по таскам

Задачи упорядочены и атомарны. Формат: **цель → шаги → файлы → критерии готовности (DoD)**.
Отмечай выполненное `[x]`.

> ⚠️ **Вне scope (ТЗ «что НЕ нужно делать»):**
> Docker / CI/CD / деплой; реальная интеграция с платёжной системой (только **заглушки**);
> аутентификация и регистрация пользователей. Не тратить на это время.

---

## T0. Каркас проекта и инфраструктура

**Цель:** запускаемое приложение с подключениями к MongoDB и Redis.

- [x] `npm init`, установка зависимостей (см. [STACK.md](STACK.md)), TS-конфиг, ESLint/Prettier.
- [x] `.env.example` (MongoDB/Redis поднимаются локально, **без Docker**).
- [x] `src/config/` — загрузка и валидация env (падать при старте, если нет секрета).
- [x] `src/app.ts` (Express, middleware) и `src/server.ts` (connect + listen).
- [x] `GET /health`.

**Файлы:** `package.json`, `tsconfig.json`, `.env.example`, `src/config/index.ts`, `src/app.ts`, `src/server.ts`.
**DoD:** `npm run dev` стартует, подключается к локальным Mongo/Redis; `/health` → 200.

---

## T1. Модели данных (Mongoose)

**Цель:** схемы инвойса, мерчанта и события вебхука.

- [x] `Merchant`: `_id`, `feePercent` (basis points / Decimal).
- [x] `Invoice`: `amount`, `currency`, `merchantId`, `fee`, `amountToReceive`,
      `status` (`pending|paid|failed`), `settledAt?`, таймстемпы. Суммы — целые минорные единицы.
- [x] `WebhookEvent`: `nonce` (**unique index**), `invoiceId`, `status`, `receivedAt`.

**Файлы:** `src/models/merchant.model.ts`, `invoice.model.ts`, `webhookEvent.model.ts`.
**DoD:** модели компилируются; unique-индекс на `nonce` создаётся.

---

## T2. Денежная арифметика

**Цель:** точный расчёт комиссии без `float`.

- [x] `computeFee(amount, feePercent)` и `computeAmountToReceive(amount, fee)` в минорных единицах.
- [x] Явное правило округления (зафиксировать в README).

**Файлы:** `src/lib/money.ts`, `tests/unit/money.test.ts`.
**DoD:** unit-тесты: типовой кейс, округление, `feePercent=0`, минимальная/крупная сумма.

---

## T3. POST /invoice

**Цель:** создание инвойса с расчётами.

- [x] DTO-валидация (`amount` > 0, `currency`, существующий `merchantId`).
- [x] Расчёт `fee`/`amountToReceive`, сохранение со статусом `pending`.
- [x] Ответ: `invoiceId`, `amount`, `fee`, `amountToReceive`, `status`.

**Файлы:** `src/modules/invoice/invoice.controller.ts`, `invoice.service.ts`, `invoice.dto.ts`.
**DoD:** integration-тест: 201 + корректные суммы; 400 на невалидный ввод; 404 на чужой мерчант.

---

## T4. GET /invoice/:id

**Цель:** чтение статуса инвойса.

- [x] Возврат документа; 404 если не найден; 400 на невалидный id.

**Файлы:** тот же `invoice.controller.ts` / `invoice.service.ts`.
**DoD:** integration-тест: 200 для существующего, 404 для отсутствующего.

---

## T5. Захват raw body для подписи

**Цель:** иметь точные байты тела для HMAC.

- [x] Middleware, сохраняющий `req.rawBody` (через `express.json({ verify })`),
      применять к `/webhook`.

**Файлы:** `src/middlewares/rawBody.ts`.
**DoD:** в обработчике доступен `rawBody`, совпадающий с отправленным.

---

## T6. Проверка HMAC-подписи

**Цель:** отклонять запросы с неверной подписью.

- [x] `verifySignature(rawBody, secret, headerSig)` — `HMAC-SHA256`, `timingSafeEqual`.
- [x] Middleware: нет/битая подпись → `401`, без побочных эффектов.

**Файлы:** `src/lib/hmac.ts`, `src/modules/webhook/signature.middleware.ts`, `tests/unit/hmac.test.ts`.
**DoD:** валидная подпись проходит; битая → 401; тест на тайминг-безопасное сравнение.

---

## T7. Защита от replay (timestamp + nonce)

**Цель:** отклонять повторы и устаревшие запросы.

- [x] Проверка `X-Timestamp` в пределах окна `WEBHOOK_TIMESTAMP_TOLERANCE_SEC` → иначе `401`.
- [x] `X-Nonce`: Redis `SET nonce 1 NX EX <TTL>`; если уже есть → повтор.
      Fallback/надёжность: unique-индекс `WebhookEvent.nonce` в Mongo.

**Файлы:** `src/lib/redis.ts`, `src/modules/webhook/replay.middleware.ts`, `tests/integration/replay.test.ts`.
**DoD:** старый timestamp → 401; повторный nonce → noop/409 без второго зачисления.

---

## T8. POST /webhook — идемпотентное зачисление (ядро)

**Цель:** `paid` зачисляет **ровно один раз**, даже при дублях и гонках.

- [x] DTO `{ invoiceId, status }` (`paid|failed`).
- [x] Redis distributed lock по `invoiceId` (сериализация конкурентных вебхуков).
- [x] Атомарный переход: `findOneAndUpdate({_id, status:'pending'}, {status, settledAt})` —
      зачисление выполняется только если апдейт реально сменил статус.
- [x] Запись `WebhookEvent`; повтор по уже обработанному nonce/событию → noop.
- [x] При `paid` — побочный эффект «зачисление» **в виде заглушки** (поле `settledAt`/лог,
      без реальной платёжки) ровно один раз.

**Файлы:** `src/modules/webhook/webhook.controller.ts`, `webhook.service.ts`, `webhook.dto.ts`.
**DoD (ключевой):**

- один webhook `paid` → одно зачисление;
- N одновременных дублей → **ровно одно** зачисление;
- повторная доставка после успеха → noop;
- `failed` → статус `failed`, без зачисления.

---

## T9. Обработка ошибок и наблюдаемость

**Цель:** предсказуемые ответы и логи.

- [x] Глобальный error-handler, единый формат `{ error: { code, message } }`.
- [x] Структурное логирование (pino) запросов и ошибок.
- [x] Корректные коды: 400/401/404/409/422/500.

**Файлы:** `src/middlewares/errorHandler.ts`, `src/lib/logger.ts`.
**DoD:** ошибки не роняют процесс; коды соответствуют ситуациям.

---

## T10. Тесты — полнота

**Цель:** покрыть три обязательных блока из ТЗ + конкурентность.

- [x] Подпись (валид/невалид). [x] Идемпотентность вебхука. [x] Расчёт комиссии.
- [x] Конкурентные дубли (Promise.all нескольких одинаковых вебхуков).
- [x] Инфраструктура тестов: `mongodb-memory-server`, тестовый/мок Redis, `supertest`.

**Файлы:** `tests/unit/*`, `tests/integration/*`, `jest.config.*`.
**DoD:** `npm test` зелёный; покрыты все обязательные сценарии.

---

## TQA. Дефекты по итогам QA-прогона

**Цель:** закрыть проблемы, найденные адверсариальным прогоном. Все воспроизведены
исполняемыми тестами в [tests/integration/qa-adversarial.test.ts](tests/integration/qa-adversarial.test.ts)
(служат репро и регрессом после фиксов). Все TQA-1…TQA-6 закрыты: `npm test` → **38 зелёных**.

### 🔴 TQA-1 (CRITICAL). Потеря зачисления при сбое `settle()` — ✅ ИСПРАВЛЕНО

- [x] Было: в `webhook.service.ts` статус переводился в `paid` **до** вызова `settle()`.
      Если `settle()` падал — инвойс оставался `paid`, а ретрай (новый nonce) ловил
      идемпотентный no-op → `settle()` не вызывался никогда. Деньги не зачислены,
      хотя инвойс «оплачен».
- [x] **Фикс:** введён внутренний флаг `settleInProgress` (`invoice.model.ts`). В `processPaid`:
      (1) атомарный «захват» `findOneAndUpdate({_id, status:'pending', settleInProgress:{$ne:true}}, {settleInProgress:true})`;
      (2) `settle()` вызывается ДО перевода в `paid`; при сбое флаг откатывается, статус
      остаётся `pending` → ретрай доводит зачисление. В `paid` переводим только после успеха.
- **Файлы:** `src/modules/webhook/webhook.service.ts`, `src/models/invoice.model.ts`.
- **DoD:** ✅ при сбое settle инвойс остаётся `pending` (не «оплачено-но-не-зачислено»);
  ретрай доводит зачисление до успеха ровно один раз. Регресс: тест «TQA-1 (fixed)».

### 🔴 TQA-2 (CRITICAL). Replay-защита не привязана к подписи — ✅ ИСПРАВЛЕНО

- [x] Было: HMAC считался только от тела; `X-Timestamp`/`X-Nonce` подписью не покрыты —
      перехваченную подпись можно переотправить с новым nonce/timestamp.
- [x] **Фикс:** подпись считается от `${X-Timestamp}.${X-Nonce}.` + rawBody
      (`buildSigningPayload` в `signature.middleware.ts`). Подмена nonce/timestamp
      инвалидирует подпись.
- **Файлы:** `src/modules/webhook/signature.middleware.ts` (+ обновлены тест-хелперы и README curl).
- **DoD:** ✅ подмена nonce/timestamp при том же теле → 401. Регресс: тест «TQA-2 (fixed)».

### 🟠 TQA-3 (HIGH). Nonce «сгорает» до бизнес-логики — ✅ ИСПРАВЛЕНО

- [x] Было: `replay.middleware.ts` регистрировал nonce (Redis+Mongo) до `processWebhook`.
      При сбое обработки (404 / 409 lock-timeout / 500) легитимный ретрай с тем же nonce
      получал `409 DUPLICATE_NONCE` и никогда не отрабатывал.
- [x] **Фикс:** `replayProtection` оставлен только на свежесть timestamp + присутствие nonce
      (без побочных эффектов). Резервация nonce вынесена в `reserveNonce`/`releaseNonce`;
      контроллер резервирует nonce, обрабатывает и при ошибке откатывает резервацию
      (`unregisterNonce` в Redis + `deleteOne` в Mongo). Успешно обработанный nonce
      остаётся durable-зарезервированным.
- **Файлы:** `src/lib/redis.ts` (`unregisterNonce`), `src/modules/webhook/replay.middleware.ts`,
  `src/modules/webhook/webhook.controller.ts`.
- **DoD:** ✅ транзиентно упавшая доставка повторяется с тем же nonce и доводится до конца;
  успешный nonce повторно использовать нельзя (409). Регресс: тесты «TQA-3 (fixed)».

### 🟡 TQA-4 (MEDIUM). `amount` без верхней границы

### 🟡 TQA-4 (MEDIUM). `amount` без верхней границы — ✅ ИСПРАВЛЕНО

- [x] Было: `invoice.dto.ts` принимал любой `int().positive()`; в Mongo `amount` — `Number`
      (double), суммы > 2^53 теряли точность на хранении.
- [x] **Фикс:** `amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)`.
- **Файлы:** `src/modules/invoice/invoice.dto.ts`.
- **DoD:** ✅ суммы вне безопасного диапазона → 400. Регресс: тест «amount выше MAX_SAFE_INTEGER».

### 🟡 TQA-5 (MEDIUM). Неатомарный `releaseLock` — ✅ ИСПРАВЛЕНО

- [x] Было: `redis.ts` делал `get` затем `del` — гонка, можно снять чужой лок между ними.
- [x] **Фикс:** Lua-скрипт `if redis.call("get",KEYS[1])==ARGV[1] then redis.call("del",KEYS[1])`
      через `eval` — проверка-и-удаление атомарны.
- **Файлы:** `src/lib/redis.ts`.
- **DoD:** ✅ чужой токен не снимает лок, свой — снимает. Регресс: `tests/unit/redis.test.ts`.

### 🟢 TQA-6 (LOW). Рост `WebhookEvent` без очистки — ✅ ИСПРАВЛЕНО

- [x] Было: запись создаётся для каждого вебхука, TTL-очистки нет → журнал растёт безгранично.
- [x] **Фикс:** TTL-индекс `{ receivedAt: 1 }, { expireAfterSeconds: nonceTtlSec }` —
      записи живут столько же, сколько nonce в Redis (дольше незачем: старый timestamp
      и так отсекается проверкой свежести).
- **Файлы:** `src/models/webhookEvent.model.ts`.
- **DoD:** ✅ TTL-индекс присутствует, старые события удаляются автоматически.
  Регресс: тест «TQA-6 — TTL-индекс».

---

## T11. README и сдача

**Цель:** ревьюер запускает за минуты.

- [x] Инструкция запуска (`npm i`, локальные Mongo/Redis, `npm run dev`, `npm test`) — **без Docker**.
- [x] Описание переменных окружения и пример запроса с подписью (curl).
- [x] **Принятые допущения** и **что не доделано + как доделать**.
- [x] Залить в GitHub/GitLab, прислать ссылку.

**Файлы:** `README.md`.
**DoD:** проект клонируется и запускается по README с нуля.

---

## Чек-лист соответствия ТЗ (финальная проверка)

- [x] Денежные расчёты точны (без float).
- [x] HMAC-SHA256 от тела + timingSafeEqual.
- [x] Защита от replay: timestamp + уникальный nonce.
- [x] `paid` зачисляет ровно один раз при любых дублях/гонках.
- [x] MongoDB (Mongoose) + Redis задействованы по назначению.
- [x] Тесты: подпись, идемпотентность, комиссия (+ конкурентность).
- [x] README с запуском, тестами, допущениями.
