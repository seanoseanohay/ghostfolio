# Progress

## What Works (Phases 1–5 Complete + Deployed + Live-Verified)

- ✅ AgentModule registered in AppModule
- ✅ POST /api/v1/agent/chat endpoint (JWT-protected)
- ✅ portfolio_analysis tool — wraps PortfolioService.getDetails() + getPerformance(), 3× retry
- ✅ market_data tool — wraps DataProviderService.getQuotes() + getHistorical(), 3× retry
- ✅ transaction_categorize tool — wraps OrderService.getOrders(), grouped by type, 3× retry
- ✅ tax_estimate tool — mocked, US-only, with legal disclaimer
- ✅ compliance_check tool — mocked, 4 check types, US-only, with disclaimer
- ✅ 4-check portfolio verifier (≥3 required by PRD)
- ✅ LangGraph ReAct agent with RedisSaver checkpointer
- ✅ Multi-tool chaining verified live (agent autonomously called portfolio_analysis + market_data in one response)
- ✅ Confidence scoring (tool success 40% + verification 40% + LLM 20%)
- ✅ traceSanitizer() for PII redaction in traces
- ✅ Angular chat GUI at /ai-chat with history sidebar + debug drawer
- ✅ AgentConversation Prisma model persists full message history
- ✅ GET /agent/conversations + GET /agent/conversations/:id endpoints
- ✅ TypeScript compiles cleanly (0 errors)
- ✅ Memory bank documentation complete
- ✅ Deployed to Railway — live at https://ghostfolio-production-1e9f.up.railway.app
- ✅ Redis Stack running on Railway (redis-stack-server with JSON + Search modules)
- ✅ PostgreSQL running on Railway with all 107 migrations applied
- ✅ Production Dockerfile fixed (root package.json + --omit=dev --ignore-scripts)

## What's Left to Build

### Phase 3 — Observability & Evals

- [x] ~~LangSmith tracing~~ done — LANGSMITH* env vars mapped to LANGCHAIN* at module load; sanitized metadata + runName/tags passed to each trace
- [x] ~~Cost tracking per request~~ done — token usage extracted from AI message usage_metadata; logged per request; estimated cost at $3/$15 per 1M in/out tokens
- [x] ~~50+ LangSmith evaluation dataset~~ done — 55 cases: 22 happy, 11 edge, 10 adversarial, 12 multi-step
- [x] ~~CI gating~~ done — run-evals.ts exits 1 if <80% pass; dry-run mode for dataset-only validation

### Phase 4 — Infrastructure

- [x] ~~Docker Compose env var updates~~ done
- [x] ~~Railway deployment~~ live
- [x] ~~ANTHROPIC_API_KEY in .env~~ done

### Phase 5 — GUI

- [x] ~~Angular chat UI~~ done — two-panel page at `/ai-chat` with history sidebar, message bubbles, debug drawer
- [x] ~~Conversation persistence~~ done — `AgentConversation` Prisma model stores full message history as JSON
- [x] ~~Past chats viewable~~ done — `GET /agent/conversations` + `GET /agent/conversations/:id` endpoints
- [x] ~~Nav link~~ done — "AI Chat" added to header (desktop + mobile)

## Known Issues / Limitations

1. `baseCurrency` in portfolio_analysis + transaction_categorize is hardcoded to 'USD' — should come from user settings
2. Redis checkpointer singleton will not reconnect if Redis disconnects mid-session
3. No unit tests written yet
4. ~~Agent UI only accessible via API~~ — Angular chat UI now at `/ai-chat`
5. market_data tool returned no quote for AAPL in live test — DataProviderService on Railway likely missing data source config (DATA_SOURCES env var or Yahoo Finance connectivity); not a code bug

## PRD Compliance Status

| Requirement            | Status                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Natural language query | ✅ via LangGraph                                                                                    |
| ≥3 functional tools    | ✅ 5 tools: portfolio_analysis, market_data, transaction_categorize, tax_estimate, compliance_check |
| Structured tool calls  | ✅ Zod schemas                                                                                      |
| Conversation memory    | ✅ Redis RedisSaver                                                                                 |
| ≥1 domain verification | ✅ 4-check verifier                                                                                 |
| ≥5 test cases          | ✅ 55 cases in libs/agent/src/evals/eval-dataset.json                                               |
| Public deployment      | ✅ Railway live                                                                                     |
| Confidence score       | ✅ implemented                                                                                      |
| Citations              | ✅ basic (tool source)                                                                              |
| Trace redaction        | ✅ traceSanitizer                                                                                   |
| LangSmith tracing      | ⏳ wired but not traced                                                                             |
| Cost tracking          | ⏳ pending                                                                                          |
