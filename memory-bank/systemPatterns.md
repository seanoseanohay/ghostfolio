# System Patterns

## Agent Architecture

```
HTTP Request
    │
    ▼
AgentController (apps/api/src/agent/agent.controller.ts)
  @Post('chat')  @UseGuards(AuthGuard('jwt'))
  Extracts userId from req.user.id
    │
    ▼
AgentService (apps/api/src/agent/agent.service.ts)
  Resolves conversationId (or generates UUID)
  Constructs threadId = agent:conversation:{userId}:{conversationId}
  Builds Redis URL from env vars
    │
    ▼
runAgentGraph() (libs/agent/src/graph/agent.graph.ts)
  Creates RedisSaver checkpointer (singleton, shared across requests)
  Creates ChatAnthropic (claude-sonnet-4-5)
  Creates tool instances bound to (portfolioService, userId)
  Calls createReactAgent({ llm, tools, checkpointSaver })
  Invokes agent with thread_id config
  Parses tool calls and tool outputs from message history
  Runs verifiers on tool outputs
  Calculates confidence score
  Returns AgentRunResult
    │
    ▼
HTTP Response: { message, toolCalls, citations, confidence, warnings, newConversationId }
```

## Tool Pattern

- Tools live in `libs/agent/src/tools/`
- Each tool receives (service, userId) via closure — no DI magic needed at tool level
- Tool execution has 3× retry with exponential backoff (500ms × attempt)
- Tool returns JSON string (LangChain tool contract)
- Tool schemas use Zod, stored in `libs/agent/src/schemas/`

## Verifier Pattern

- Verifiers live in `libs/agent/src/verifiers/`
- Each tool output is verified by its corresponding verifier after tool call
- Verifier runs ≥3 checks, returns `VerificationResult { passed, score, checks, warnings }`
- Verification score feeds into confidence calculation (40% weight)

## Confidence Calculation (PRD §7)

```
confidence = toolSuccessRate(40%) + verificationPassed(40%) + llmValidity(20%)
```

Confidence < 0.8 → adds warning to response.

## Memory Persistence

- Redis checkpointer (RedisSaver) with thread_id = `agent:conversation:{userId}:{conversationId}`
- TTL: AGENT_MEMORY_TTL_DAYS (default 7 days)
- Singleton checkpointer + Redis client (initialized on first request)

## Brownfield Compliance

- PortfolioService.getDetails() and getPerformance() called with explicit userId
- Never bypass JWT auth — AgentController requires AuthGuard('jwt')
- PortfolioModule imported into AgentModule (not just PortfolioService)
- All new code in libs/agent/ and apps/api/src/agent/ — zero changes to existing services

## NestJS Module Structure

```
AppModule
  └── AgentModule
        ├── AgentController (POST /agent/chat)
        ├── AgentService
        └── imports: [PortfolioModule]
              └── PortfolioModule exports: [PortfolioService]
```

## Trace Sanitization

- `traceSanitizer()` in `libs/agent/src/verifiers/trace-sanitizer.ts`
- Redacts: userId → hash:sha256[:12], accountId → hash:sha256[:12]
- Buckets dollar values: <$100, $100-$999, $1k-$9,999, $10k-$99,999, $100k+
- Preserves: symbols, percentages, errors, latencies
