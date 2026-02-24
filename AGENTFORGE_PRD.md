# Ghostfolio AgentForge -- Finance Domain Agent

## Product Requirements Document + Completed Pre-Search

Date: February 23, 2026 Observability & Evaluation: LangSmith (Primary)

---

# 1. Completed Pre-Search (Submission Artifact)

## Domain & Repository

- **Domain:** Finance
- **Repository Forked:** https://github.com/ghostfolio/ghostfolio
- **Goal:** Build a production-ready AI agent for natural language
  portfolio queries and financial analysis integrated into the
  Ghostfolio monorepo.

## Final Stack Decisions

- **Backend:** NestJS (existing) + LangGraph.js + LangChain.js
- **LLM:** Tiered — Claude 3 Haiku (router + simple lookups) / Claude Sonnet 4.5 (complex analysis) via @langchain/anthropic
- **Observability & Evals:** LangSmith (primary)
- **DB/ORM:** Prisma + PostgreSQL (existing)
- **State Persistence:** Redis (existing; namespaced for agent)
- **Monorepo:** Nx
- **Frontend:** Minimal Angular chat component (optional enhancement)
- **Deployment:** Extend existing Docker Compose + Railway

## Constraints & Reliability

- High-stakes financial domain
- Cross-check claims against Prisma DB + external APIs
- 80% confidence threshold minimum
- CI gating required
- Token tracking and cost control required
- No raw PII stored or traced

---

# 2. AgentForge Requirements Alignment

## MVP Hard Gate Requirements

- Natural language query support
- ≥3 functional tools
- Structured tool calls
- Conversation memory
- ≥1 domain verification check
- ≥5 test cases
- Public deployment

## Required Agent Components

- Reasoning Engine (LLM structured output)
- Tool Registry
- Memory System
- LangGraph Orchestrator
- Verification Layer (≥3 checks)
- Output Formatter (citations + confidence)

## Performance Targets

Metric Target

---

Single-tool latency \<5s
Multi-step latency \<15s
Tool success rate \>95%
Eval pass rate \>80%
Hallucination rate \<5%
Verification accuracy \>90%

---

# 3. Implementation Specification (Cursor-Ready)

## File-Level Separation

---

Layer Location Responsibility

---

Tools libs/agent/src/tools/ Pure execution; reuse existing
services

Schemas libs/agent/src/schemas/ Zod schemas + LangGraph tool
definitions

Verifiers libs/agent/src/verifiers/ Fact-check, confidence, domain
rules

Graph libs/agent/src/graph/ LangGraph state machine

Controller apps/api/src/agent/ HTTP + NestJS module

Evals libs/agent/src/evals/ LangSmith datasets + CI gating

---

Tools must not call other tools directly. All chaining occurs through
LangGraph.

---

# 4. Authentication & Portfolio Scoping

- Use existing Ghostfolio JWT auth.
- Derive userId from req.user.id.
- Never accept userId in request body.
- Default portfolio resolution:
  1.  Most recently updated account
  2.  Else first created
  3.  Else return clarifying message

Unauthorized access → 401.

---

# 5. Tool Specifications

## portfolio_analysis

**Input**

```ts
{ accountId?: string }
```

**Output**

```ts
{
  baseCurrency: string,
  asOf: string,
  holdings: Array<{
    symbol: string,
    quantity: number,
    value: number
  }>,
  allocation: Array<{
    sector?: string,
    assetClass?: string,
    percentage: number
  }>,
  performance: {
    totalReturn: number,
    ytdReturn: number
  }
}
```

Rules: - Sector missing → use assetClass or "UNKNOWN" + warning. - Must
include baseCurrency + asOf. - Reuse PortfolioService.

---

## market_data

**Input**

```ts
{ symbols: string[], metrics?: string[] }
```

Default metrics: `['price','marketCap']`

**Output**

```ts
{
  [symbol: string]: {
    price?: number,
    marketCap?: number,
    currency?: string,
    dayChangePct?: number,
    source: 'yahoo' | 'coingecko' | 'cached',
    asOf: string
  }
}
```

Crypto fallback: - Use Ghostfolio asset metadata if available. - Else
symbol pattern detection. - Else no fallback → error + warning.

Cache TTL: 5 minutes.

---

## transaction_categorize

**Input**

```ts
{ accountId: string, dateRange?: { start?: string, end?: string } }
```

Defaults: - end = now - start = end - 30 days (or account inception if
shorter)

**Output**

```ts
{
  currency: string,
  dateRange: { start: string, end: string },
  totals: { inflow: number, outflow: number },
  categories: Array<{
    category: string,
    amount: number,
    patterns: string[]
  }>
}
```

Amounts are signed.

---

## Production Tools (Mocked Initially)

### tax_estimate

```ts
{ income: number, deductions: number }
→ { estimatedLiability: number }
```

Include disclaimer.

### compliance_check

```ts
{ transaction: { type: string, symbol: string, amount: number }, regulations?: string[] }
→ { violations: string[], warnings: string[] }
```

US-only. Include disclaimer.

---

# 6. API Contract

POST `/api/v1/agent/chat`

## Request

```json
{ "query": "string", "conversationId"?: "string" }
```

## Response

```json
{
  "message": "string",
  "toolCalls": [
    {
      "name": "string",
      "input": {},
      "success": true,
      "durationMs": 0
    }
  ],
  "citations": [
    {
      "source": "prisma" | "yahoo" | "coingecko" | "computed" | "tool",
      "detail": "string",
      "asOf"?: "string",
      "toolCallId"?: "string"
    }
  ],
  "confidence": 0.0,
  "warnings": [],
  "newConversationId"?: "string"
}
```

Every externally sourced number must have at least one citation.

---

# 7. Confidence Calculation

Confidence score = weighted heuristic:

- Tool success rate (40%)
- Verification checks passed (40%)
- LLM internal signal / structured validity (20%)

Confidence \< 0.8 → escalate / warn.

---

# 8. Memory Persistence

Redis Key:

    agent:conversation:${userId}:${conversationId}

Store: - Last 10 messages - Last 10 tool outputs

Tool output structure:

```ts
{
  type: string,
  keyFields: Record<string, any>,
  rawHash: string,
  summary: string
}
```

TTL: 7 days (AGENT_MEMORY_TTL_DAYS)

---

# 9. Trace Redaction

Central function:

    traceSanitizer(data: any)

Redact: - userId (hash) - accountId (hash) - Dollar values → bucket:

Buckets: - \<\$100 - \$100--\$999 - \$1k--\$9,999 - \$10k--\$99,999 -
\$100k+

Keep: - Symbols - Percentages - Errors - Latencies

Tracing: - Enabled in dev/staging - Prod opt-in via
LANGSMITH_TRACING_ENABLED

---

# 10. Evaluation Framework

- 50+ LangSmith dataset cases
- 20+ happy
- 10+ edge
- 10+ adversarial
- 10+ multi-step

CI gating: - \<80% pass → fail merge - \>5% hallucination → fail merge

---

# 11. Cost Tracking

Track: - Tokens per request - Cost per request - Dev total spend

**Tiered Model Strategy (implemented 2026-02-24):**

Every request passes through a lightweight Haiku router call (~$0.0001) before
the main ReAct loop. The router classifies query complexity and selects tools:

- Simple (single-tool lookup, e.g. "price of AAPL?") → Haiku ReAct loop + filtered tools (~$0.001/query)
- Complex (multi-tool, reasoning, analysis) → Sonnet ReAct loop + relevant tools (~$0.015–0.025/query)

Rule-based keyword escalation (e.g. "should I", "compare", "rebalance") forces
Sonnet regardless of the router's classification, ensuring financial reasoning
queries always get the more capable model.

`tokenUsage` in every response includes `modelUsed` and `complexity` fields for
per-request cost attribution and long-term spend analysis.

Projection required at: - 100 users - 1k users - 10k users - 100k users

**Projected cost per 1k queries (mix: 70% simple, 30% complex):**

| Scenario     | Before (Sonnet only) | After (tiered) | Savings |
| ------------ | -------------------- | -------------- | ------- |
| 1k queries   | ~$15                 | ~$1.20         | ~92%    |
| 10k queries  | ~$150                | ~$12           | ~92%    |
| 100k queries | ~$1,500              | ~$120          | ~92%    |

---

# 12. Deployment

- Extend existing Docker Compose
- Add LANGSMITH_API_KEY
- Add AGENT_MEMORY_TTL_DAYS
- Add LANGSMITH_TRACING_ENABLED
- Railway deploy from fork
- Public URL required

---

# 13. Production Readiness Checklist

- 5 tools operational
- Verification active
- 50+ evals passing
- LangSmith tracing live
- Cost tracking implemented
- Deployment live
- Architecture documentation complete
- AI cost analysis complete
- Open-source dataset released

---

# 14. Cursor Execution Instruction

Build the complete Ghostfolio AI agent exactly according to this PRD.
Respect existing NestJS and Prisma services. Start with: 1. agent
module + portfolio_analysis tool 2. LangGraph orchestrator 3. API
controller 4. Remaining tools 5. Verification layer 6. LangSmith
integration 7. Evaluation dataset + CI 8. Optional minimal Angular chat
UI last.

No architectural deviations.
