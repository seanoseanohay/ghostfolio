# Deployment Guide — Ghostfolio AgentForge

## Live Deployment

**URL:** https://ghostfolio-production-1e9f.up.railway.app

## Using the AI Agent

### Step 1 — Get your access token

Log into the Ghostfolio UI → User Settings → copy your **Security Token** (long hex string).

### Step 2 — Exchange for a JWT

```bash
curl https://ghostfolio-production-1e9f.up.railway.app/api/v1/auth/anonymous/YOUR_ACCESS_TOKEN
```

Copy the `authToken` value from the response (`eyJ...`).

### Step 3 — Call the agent

```bash
curl -X POST https://ghostfolio-production-1e9f.up.railway.app/api/v1/agent/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"query": "What does my portfolio look like?"}'
```

### Step 4 — Continue a conversation

Pass `conversationId` from the previous response to maintain context:

```bash
curl -X POST https://ghostfolio-production-1e9f.up.railway.app/api/v1/agent/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"query": "Which holding has the best return?", "conversationId": "ID_FROM_PREVIOUS_RESPONSE"}'
```

### Response shape

```json
{
  "message": "Natural language response from Claude",
  "toolCalls": [
    {
      "name": "portfolio_analysis",
      "input": {},
      "success": true,
      "durationMs": 0
    }
  ],
  "citations": [
    {
      "source": "tool",
      "detail": "Data retrieved via portfolio_analysis",
      "asOf": "..."
    }
  ],
  "confidence": 1,
  "warnings": [],
  "newConversationId": "uuid-for-next-request"
}
```

---

## Railway Services

| Service     | Type                                 | Notes                                    |
| ----------- | ------------------------------------ | ---------------------------------------- |
| API         | GitHub → Dockerfile                  | NestJS app, auto-deploys on push to main |
| PostgreSQL  | Railway addon                        | 107 migrations applied at startup        |
| Redis Stack | Custom Docker (`redis-stack-server`) | Required for JSON + Search modules       |

### Required environment variables (API service)

| Variable                    | Description                              |
| --------------------------- | ---------------------------------------- |
| `DATABASE_URL`              | `${{Postgres.DATABASE_URL}}`             |
| `REDIS_HOST`                | Private domain of Redis Stack service    |
| `REDIS_PORT`                | `6379`                                   |
| `REDIS_PASSWORD`            | Matches `REDIS_ARGS` in Redis service    |
| `REDIS_DB`                  | `0`                                      |
| `ACCESS_TOKEN_SALT`         | Random string (required by envalid)      |
| `JWT_SECRET_KEY`            | Random string (required by envalid)      |
| `ANTHROPIC_API_KEY`         | Claude API key                           |
| `LANGSMITH_API_KEY`         | LangSmith tracing key (optional)         |
| `LANGSMITH_TRACING_ENABLED` | `true` or `false`                        |
| `AGENT_MEMORY_TTL_DAYS`     | `7` (days to retain conversation memory) |

### Market data (agent `market_data` tool)

For the agent to return stock prices (e.g. AAPL), ensure:

| Variable          | Value                                           | Notes                                                                |
| ----------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| `DATA_SOURCES`    | `["COINGECKO","MANUAL","YAHOO"]` or leave unset | Must include `YAHOO` for stocks. Default is correct if unset.        |
| `REQUEST_TIMEOUT` | `10000` or `15000` (milliseconds)               | Optional. Default 3000ms may be too short for Yahoo from datacenter. |

**If `DATA_SOURCES` is set in Railway**, ensure it includes `YAHOO`. Example valid value: `["COINGECKO","MANUAL","YAHOO"]`.

### Redis Stack service environment variable

| Variable     | Value                               |
| ------------ | ----------------------------------- |
| `REDIS_ARGS` | `--requirepass your-redis-password` |

---

## Local Development

```bash
# Start Postgres + Redis Stack
docker compose -f docker/docker-compose.dev.yml up -d

# Run DB migrations and seed
npm run database:setup

# Start NestJS API (watch mode)
npm run start:server

# Start Angular UI (separate terminal)
npm run start:client
```

**Important:** The local Redis must use `redis-stack-server` (not plain `redis:alpine`) because
`@langchain/langgraph-checkpoint-redis` requires the RedisJSON and RediSearch modules.
The `docker-compose.yml` is configured correctly — it uses `redis/redis-stack-server:latest`
with `redis-stack-server` as the command binary.

---

## Key Dockerfile Notes

The production Dockerfile uses the **root** `package.json` (not the Nx-generated minimal one)
for the production `npm install`. This is required because Nx's `generatePackageJson` feature
misses LangChain transitive dependencies when tsconfig path aliases cause webpack to treat
them as local file imports rather than node_module externals.

```dockerfile
# Correct approach (dist stage):
COPY ./package.json /ghostfolio/dist/apps/api/
COPY ./package-lock.json /ghostfolio/dist/apps/api/
RUN npm install --omit=dev --ignore-scripts
COPY prisma /ghostfolio/dist/apps/api/prisma/
RUN npm run database:generate-typings
```

The `--ignore-scripts` flag skips the `postinstall` hook (which runs `prisma generate`)
because the prisma schema hasn't been copied yet at that point.
