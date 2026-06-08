# Технологический стек

## Обязательное (из ТЗ)

| Технология              | Назначение                                                    | Почему                                                |
|-------------------------|--------------------------------------------------------------|-------------------------------------------------------|
| **Node.js (LTS 20+)**   | Рантайм                                                       | Требование ТЗ                                         |
| **Express**             | HTTP-фреймворк, роутинг, middleware                          | Требование ТЗ; минимум магии, явный контроль          |
| **MongoDB + Mongoose**  | Хранение инвойсов и обработанных nonce/событий               | Требование ТЗ; ODM со схемами и валидацией            |
| **Redis**               | Хранилище nonce с TTL, распределённая блокировка, дедуп        | Требование ТЗ («для дополнительной надёжности»)        |
| **Jest** (или Mocha)    | Тесты (unit + integration)                                    | Требование ТЗ                                          |

## Рекомендуемое (повышает оценку)

| Технология                       | Назначение                                                        |
|----------------------------------|------------------------------------------------------------------|
| **TypeScript**                   | Типобезопасность (опционально в ТЗ, но плюс к читаемости)         |
| **Zod / Joi**                    | Валидация входных DTO (`amount`, `currency`, `merchantId`, payload)|
| **`crypto` (встроенный)**        | HMAC-SHA256, `crypto.timingSafeEqual` для сравнения подписей      |
| **mongodb-memory-server**        | In-memory Mongo для интеграционных тестов без внешней БД          |
| **ioredis-mock** / тестовый Redis| Тесты логики nonce/локов без реального Redis                      |
| **dotenv**                       | Конфиг через переменные окружения (секрет HMAC, URI БД)          |
| **pino** + pino-http             | Структурное логирование запросов и ошибок                        |
| **supertest**                    | Чёрный-ящик HTTP-тесты эндпоинтов                                |
| **ESLint + Prettier**            | Единый стиль, чистота кода                                        |

> ⚠️ **Docker / docker-compose НЕ используем** — по ТЗ контейнеризация, CI/CD и
> деплой явно в списке «что НЕ нужно делать». MongoDB и Redis для локального
> запуска поднимаются разработчиком самостоятельно (локально/облако), URI — через `.env`.
> Для тестов внешние сервисы не нужны: `mongodb-memory-server` + мок Redis.

## Денежная арифметика

- Хранить и считать суммы в **минорных единицах (целые: копейки/центы)** —
  никаких `float`. Альтернатива: `decimal.js` / `Mongoose Decimal128`.
- `feePercent` хранить как целое в базисных пунктах (basis points) или как Decimal,
  округление по явному правилу (банковское/вниз) — зафиксировать в README.

## Переменные окружения (`.env`)

```
PORT=3000
MONGO_URI=mongodb://localhost:27017/payments
REDIS_URL=redis://localhost:6379
WEBHOOK_HMAC_SECRET=<shared-secret>
WEBHOOK_TIMESTAMP_TOLERANCE_SEC=300   # окно свежести X-Timestamp
NONCE_TTL_SEC=600                     # >= окна timestamp
```

## Предлагаемая структура каталогов

```
payment-service/
├── src/
│   ├── app.ts                 # сборка Express-приложения (без listen)
│   ├── server.ts              # bootstrap: connect Mongo/Redis + listen
│   ├── config/                # env, константы
│   ├── models/
│   │   ├── invoice.model.ts
│   │   ├── merchant.model.ts
│   │   └── webhookEvent.model.ts
│   ├── modules/
│   │   ├── invoice/           # controller + service + dto
│   │   └── webhook/           # controller + signature + idempotency + service
│   ├── lib/
│   │   ├── money.ts           # арифметика в минорных единицах
│   │   ├── hmac.ts            # подпись/проверка
│   │   └── redis.ts           # клиент, nonce, locks
│   └── middlewares/           # error handler, raw-body, validation
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── package.json
└── README.md
```
