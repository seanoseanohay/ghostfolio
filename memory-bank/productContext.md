# Product Context

## Why This Project Exists

Ghostfolio is an open-source personal finance/portfolio tracker. Users already track their investments, but must interpret the data themselves. The AI agent gives users a natural language interface to ask questions like:

- "How is my portfolio performing this year?"
- "What's my largest position?"
- "Am I too concentrated in tech stocks?"
- "Estimate my capital gains tax for this year"

## Problems It Solves

1. **Insight gap:** Users have data but lack the time/knowledge to derive insights
2. **Query friction:** Getting portfolio data requires navigating multiple screens
3. **Financial literacy:** The agent explains concepts and interprets numbers in plain language

## How It Works

1. User sends a natural language query via POST /api/v1/agent/chat
2. Agent uses LangGraph ReAct loop to decide which tools to call
3. Tools fetch real data from existing Ghostfolio services (PortfolioService, etc.)
4. LLM synthesizes tool outputs into a coherent, cited response
5. Conversation memory persists in Redis for follow-up questions

## User Experience Goals

- Responses under 5s for single-tool queries, under 15s for multi-step
- Every number cited with its source and timestamp
- Confidence score shown so users know when to verify independently
- Disclaimers for tax/legal questions
- No hallucinated financial data

## API Contract

```
POST /api/v1/agent/chat
Authorization: Bearer <jwt>
{ "query": "string", "conversationId"?: "string" }

Response:
{
  "message": "string",
  "toolCalls": [{ "name", "input", "success", "durationMs" }],
  "citations": [{ "source", "detail", "asOf", "toolCallId" }],
  "confidence": 0.0-1.0,
  "warnings": [],
  "newConversationId": "string"
}
```
