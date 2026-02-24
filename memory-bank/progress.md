# Progress

## What Works (Phase 1 Complete + Deployed)

- ✅ AgentModule registered in AppModule
- ✅ POST /api/v1/agent/chat endpoint (JWT-protected)
- ✅ portfolio_analysis tool with Zod schema + 3× retry
- ✅ 4-check portfolio verifier (≥3 required by PRD)
- ✅ LangGraph ReAct agent with RedisSaver checkpointer
- ✅ Confidence scoring (tool success 40% + verification 40% + LLM 20%)
- ✅ traceSanitizer() for PII redaction in traces
- ✅ TypeScript compiles cleanly (0 errors)
- ✅ Memory bank documentation complete
- ✅ Deployed to Railway — live at https://ghostfolio-production-1e9f.up.railway.app
- ✅ Redis Stack running on Railway (redis-stack-server with JSON + Search modules)
- ✅ PostgreSQL running on Railway with all 107 migrations applied
- ✅ Production Dockerfile fixed (root package.json + --omit=dev --ignore-scripts)

## What's Left to Build

### Phase 2 — Remaining Tools

- [ ] market_data tool (reuse DataProviderService/MarketDataService)
- [ ] transaction_categorize tool (reuse OrderService)
- [ ] tax_estimate tool (mocked, with disclaimer)
- [ ] compliance_check tool (mocked, US-only, with disclaimer)

### Phase 3 — Observability & Evals

- [ ] LangSmith tracing integration with traceSanitizer
- [ ] Cost tracking per request (token usage)
- [ ] 50+ LangSmith evaluation dataset
- [ ] CI gating (<80% pass fails merge)

### Phase 4 — Infrastructure

- [x] ~~Docker Compose env var updates~~ done
- [x] ~~Railway deployment~~ live
- [x] ~~ANTHROPIC_API_KEY in .env~~ done

### Phase 5 — Optional

- [ ] Angular chat UI component

## Known Issues / Limitations

1. `baseCurrency` in portfolio_analysis is hardcoded to 'USD' — should come from user settings
2. Redis checkpointer singleton will not reconnect if Redis disconnects mid-session
3. No unit tests written yet
4. Agent UI only accessible via API (no Angular frontend yet)

## PRD Compliance Status

| Requirement            | Status                           |
| ---------------------- | -------------------------------- |
| Natural language query | ✅ via LangGraph                 |
| ≥3 functional tools    | 🔄 1/3 (portfolio_analysis only) |
| Structured tool calls  | ✅ Zod schemas                   |
| Conversation memory    | ✅ Redis RedisSaver              |
| ≥1 domain verification | ✅ 4-check verifier              |
| ≥5 test cases          | ⏳ pending                       |
| Public deployment      | ✅ Railway live                  |
| Confidence score       | ✅ implemented                   |
| Citations              | ✅ basic (tool source)           |
| Trace redaction        | ✅ traceSanitizer                |
| LangSmith tracing      | ⏳ wired but not traced          |
| Cost tracking          | ⏳ pending                       |
