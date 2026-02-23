# Active Context

## Current Work Focus

Phase 1 complete: AgentModule skeleton + portfolio_analysis tool implemented.

## What Was Just Implemented (2026-02-23)

1. **Packages installed:** @langchain/anthropic, @langchain/langgraph v1.1.5, @langchain/core, langsmith, zod, ioredis, @langchain/langgraph-checkpoint-redis
2. **libs/agent/src/schemas/portfolio-analysis.schema.ts** — Zod input/output schemas
3. **libs/agent/src/tools/portfolio-analysis.tool.ts** — DynamicStructuredTool wrapping PortfolioService.getDetails() + getPerformance(), 3× retry
4. **libs/agent/src/verifiers/portfolio-analysis.verifier.ts** — 4-check verifier (3 core + 1 informational)
5. **libs/agent/src/verifiers/trace-sanitizer.ts** — PII redaction for LangSmith traces
6. **libs/agent/src/graph/agent.graph.ts** — LangGraph createReactAgent + RedisSaver checkpointer
7. **libs/agent/src/index.ts** — barrel export
8. **apps/api/src/agent/dto/chat.dto.ts** — ChatRequestDto
9. **apps/api/src/agent/agent.service.ts** — Orchestrates runAgentGraph()
10. **apps/api/src/agent/agent.controller.ts** — POST /agent/chat with JWT guard
11. **apps/api/src/agent/agent.module.ts** — AgentModule importing PortfolioModule
12. **apps/api/src/app/app.module.ts** — Added AgentModule import
13. **tsconfig.base.json** — Added @ghostfolio/agent and LangGraph subpath aliases
14. **memory-bank/** — All 6 core files created

## TypeScript Status

✅ `tsc --project apps/api/tsconfig.app.json --noEmit` passes with 0 errors.

## Key Technical Decisions Made

- Used `new DynamicStructuredTool()` instead of `tool()` helper to avoid TS2589 (type instantiation too deep)
- Schema passed as `as any` to DynamicStructuredTool to avoid same TS issue
- Added path aliases for `@langchain/langgraph/prebuilt` and `@langchain/langgraph-checkpoint-redis` to fix node10 moduleResolution incompatibility
- RedisSaver initialized as a module-level singleton (not per-request) to avoid connection overhead
- `tools: tools as any` passed to createReactAgent to avoid deep generic inference

## Next Steps (Phase 2)

1. Implement `market_data` tool (reuse DataProviderService/MarketDataService)
2. Implement `transaction_categorize` tool (reuse OrderService)
3. Add `tax_estimate` and `compliance_check` mocked tools
4. Implement LangSmith tracing with traceSanitizer integration
5. Add cost tracking (token usage logging)
6. Write evaluation dataset (50+ LangSmith cases)
7. Docker Compose env var updates (ANTHROPIC_API_KEY, LANGSMITH_API_KEY, etc.)
8. CI evaluation gating
9. Optional: Angular chat UI component

## Active Decisions & Considerations

- PortfolioService is used via PortfolioModule export, not direct injection — preserves module encapsulation
- AgentService is singleton-scoped (no @Inject(REQUEST)) — userId passed explicitly from controller
- baseCurrency hardcoded as 'USD' in portfolio_analysis tool — should be derived from user settings in Phase 2
- Redis checkpointer uses a global singleton to avoid re-connecting on every request
