# Tech Context

## Monorepo Stack

- **Framework:** Nx monorepo, NestJS v11 API, Angular v21 client
- **ORM:** Prisma 6 + PostgreSQL
- **Auth:** Passport JWT (`AuthGuard('jwt')`) → `req.user` is `UserWithSettings`; `req.user.id` is the userId
- **Caching:** `@nestjs/cache-manager` + `@keyv/redis` (existing `RedisCacheService`)
- **Queues:** Bull (Redis-backed)
- **Existing AI SDK:** `ai` v4.3.16 (Vercel AI SDK, used by existing `AiModule`)

## New Agent Dependencies (added 2026-02-23)

- `@langchain/anthropic` — Claude 3 Haiku (router + simple) and Claude Sonnet 4.5 (complex)
- `@langchain/core` — base LangChain types
- `@langchain/langgraph` v1.1.5 — agent orchestration
- `@langchain/langgraph-checkpoint-redis` — Redis checkpointer (uses `redis` npm package)
- `@langchain/langgraph-checkpoint` — base checkpointer
- `langsmith` — tracing
- `zod` — schema validation (also transitively present via other deps)
- `ioredis` — installed but not used by agent (checkpoint-redis uses `redis` directly)

## Path Aliases (tsconfig.base.json)

```
@ghostfolio/agent         → libs/agent/src/index.ts
@ghostfolio/agent/*       → libs/agent/src/*
@ghostfolio/api/*         → apps/api/src/*
@ghostfolio/common/*      → libs/common/src/lib/*
@ghostfolio/ui/*          → libs/ui/src/lib/*
@langchain/langgraph/prebuilt → node_modules/@langchain/langgraph/dist/prebuilt/index
@langchain/langgraph-checkpoint-redis → node_modules/@langchain/langgraph-checkpoint-redis/dist/index
```

Note: Path aliases for LangGraph subpaths are required because apps/api uses `moduleResolution: node10`.

## Key Service Signatures

### PortfolioService (apps/api/src/app/portfolio/portfolio.service.ts)

- `getDetails({ dateRange?, filters?, impersonationId, userId, withExcludedAccounts?, withMarkets?, withSummary? }): Promise<PortfolioDetails & { hasErrors }>`
- `getPerformance({ dateRange?, filters?, impersonationId, userId }): Promise<PortfolioPerformanceResponse>`
- `getHoldings({ dateRange, filters?, impersonationId, userId })`
- Requires `@Inject(REQUEST)` → is effectively request-scoped; must be used within a request context

### PortfolioDetails.holdings

- Type: `{ [symbol: string]: PortfolioPosition }`
- Key fields per position: `symbol, quantity, valueInBaseCurrency, assetClass, sectors: Sector[]`

### PortfolioPerformance

- `netPerformance, netPerformancePercentage, totalInvestment, currentValueInBaseCurrency`

### DataProviderService (apps/api/src/services/data-provider/data-provider.service.ts)

- `getQuotes({ items: AssetProfileIdentifier[], requestTimeout?, useCache?, user? }): Promise<{ [symbol: string]: DataProviderResponse }>`
- `getHistorical(items: AssetProfileIdentifier[], granularity: 'day'|'month', from: Date, to: Date): Promise<{ [symbol: string]: { [date: string]: DataProviderHistoricalResponse } }>`
- `AssetProfileIdentifier = { dataSource: DataSource, symbol: string }` — DataSource from `@prisma/client`
- `DataProviderResponse = { currency, dataSource, marketPrice, marketState }`
- Exported from `DataProviderModule`; that module has a complex provider factory — always import the full module, never just the service

### OrderService (apps/api/src/app/order/order.service.ts)

- `getOrders({ endDate?, filters?, includeDrafts?, skip?, sortColumn?, sortDirection?, startDate?, take?, types?, userCurrency, userId, withExcludedAccountsAndActivities? }): Promise<ActivitiesResponse>`
- `ActivitiesResponse = { activities: Activity[], count: number }`
- `Activity extends Order` with extra fields: `account, feeInBaseCurrency, feeInAssetProfileCurrency, SymbolProfile, value, valueInBaseCurrency`
- `userCurrency` is required — hardcoded to 'USD' in agent tool (known limitation)
- Exported from `OrderModule`

## Environment Variables (agent-specific)

- `ANTHROPIC_API_KEY` — Claude API key
- `LANGSMITH_API_KEY` — LangSmith tracing
- `LANGSMITH_TRACING_ENABLED` — 'true' to enable tracing
- `AGENT_MEMORY_TTL_DAYS` — Redis TTL for conversations (default: 7)
- `REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB` — existing Redis config

## Module Resolution Issue

The `apps/api/tsconfig.app.json` uses `moduleResolution: node10` which doesn't support package exports subpaths. Fixed by adding manual path aliases in `tsconfig.base.json` for `@langchain/langgraph/prebuilt` and `@langchain/langgraph-checkpoint-redis`.

## Production Deployment (Railway)

- **Live URL:** https://ghostfolio-production-1e9f.up.railway.app
- **Services:** API (Dockerfile), PostgreSQL (Railway addon), Redis Stack (custom `redis/redis-stack-server:latest` image)
- **Redis Stack config:** Must use `redis-stack-server` binary in the docker `command:` (NOT `redis-server`) to load JSON + Search modules required by `@langchain/langgraph-checkpoint-redis`
- **Dockerfile production fix:** Nx `generatePackageJson: true` misses LangChain transitive deps (e.g. `decamelize`) because tsconfig path aliases cause webpack to resolve them as local files rather than node_module externals. Fix: copy root `package.json` into `dist/apps/api/` BEFORE running `npm install --omit=dev --ignore-scripts`, then run `database:generate-typings` explicitly after copying prisma schema.
- **railway.toml:** Sets `healthcheckPath = "/api/v1/health"`, `healthcheckTimeout = 300`
