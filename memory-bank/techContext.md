# Tech Context

## Monorepo Stack

- **Framework:** Nx monorepo, NestJS v11 API, Angular v21 client
- **ORM:** Prisma 6 + PostgreSQL
- **Auth:** Passport JWT (`AuthGuard('jwt')`) → `req.user` is `UserWithSettings`; `req.user.id` is the userId
- **Caching:** `@nestjs/cache-manager` + `@keyv/redis` (existing `RedisCacheService`)
- **Queues:** Bull (Redis-backed)
- **Existing AI SDK:** `ai` v4.3.16 (Vercel AI SDK, used by existing `AiModule`)

## New Agent Dependencies (added 2026-02-23)

- `@langchain/anthropic` — Claude Sonnet 4.5
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

## Environment Variables (agent-specific)

- `ANTHROPIC_API_KEY` — Claude API key
- `LANGSMITH_API_KEY` — LangSmith tracing
- `LANGSMITH_TRACING_ENABLED` — 'true' to enable tracing
- `AGENT_MEMORY_TTL_DAYS` — Redis TTL for conversations (default: 7)
- `REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB` — existing Redis config

## Module Resolution Issue

The `apps/api/tsconfig.app.json` uses `moduleResolution: node10` which doesn't support package exports subpaths. Fixed by adding manual path aliases in `tsconfig.base.json` for `@langchain/langgraph/prebuilt` and `@langchain/langgraph-checkpoint-redis`.
