# Project Brief: Ghostfolio AI Agent

## Repository

Forked from https://github.com/ghostfolio/ghostfolio

## Goal

Build a production-ready finance AI agent integrated into the existing Ghostfolio NestJS/Prisma/Nx monorepo. The agent answers natural language portfolio queries using real portfolio data via LangGraph + Claude.

## Core Requirements

- Natural language query support via POST /api/v1/agent/chat
- ≥3 functional tools (portfolio_analysis, market_data, transaction_categorize + 2 mocked)
- Structured tool calls with Zod schemas
- Conversation memory (Redis, 7-day TTL)
- ≥1 domain verification check (≥3 checks implemented)
- ≥5 test cases (50+ LangSmith evals planned)
- Public deployment via Railway

## Hard Brownfield Rules

- Reuse existing PortfolioService, MarketDataService — never duplicate Prisma queries
- userId always from JWT req.user.id, never from request body
- Redis keys: agent:conversation:{userId}:{conversationId}
- New code isolated to libs/agent/src/ and apps/api/src/agent/
- No PII in traces — traceSanitizer() redacts userId, accountId, dollar values
