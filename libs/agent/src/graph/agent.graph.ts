import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';

import { ChatAnthropic } from '@langchain/anthropic';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createClient } from 'redis';

import {
  PortfolioAnalysisOutput,
  PortfolioAnalysisOutputSchema
} from '../schemas/portfolio-analysis.schema';
import { createComplianceCheckTool } from '../tools/compliance-check.tool';
import { createMarketDataTool } from '../tools/market-data.tool';
import { createPortfolioAnalysisTool } from '../tools/portfolio-analysis.tool';
import { createTaxEstimateTool } from '../tools/tax-estimate.tool';
import { createTransactionCategorizeTool } from '../tools/transaction-categorize.tool';
import {
  VerificationResult,
  verifyPortfolioAnalysis
} from '../verifiers/portfolio-analysis.verifier';
import { traceSanitizer } from '../verifiers/trace-sanitizer';
import {
  HAIKU_INPUT_COST_PER_M,
  HAIKU_MODEL,
  HAIKU_OUTPUT_COST_PER_M,
  SONNET_INPUT_COST_PER_M,
  SONNET_MODEL,
  SONNET_OUTPUT_COST_PER_M,
  routeQuery
} from './query-router';

// Map Ghostfolio env vars → LangChain SDK env vars at module load
// LangChain reads LANGCHAIN_TRACING_V2 + LANGCHAIN_API_KEY + LANGCHAIN_PROJECT
if (process.env.LANGSMITH_TRACING_ENABLED === 'true') {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  if (process.env.LANGSMITH_API_KEY && !process.env.LANGCHAIN_API_KEY) {
    process.env.LANGCHAIN_API_KEY = process.env.LANGSMITH_API_KEY;
  }
  if (!process.env.LANGCHAIN_PROJECT) {
    process.env.LANGCHAIN_PROJECT = 'ghostfolio-agent';
  }
}

export interface AgentGraphConfig {
  redisUrl: string;
  langsmithTracingEnabled: boolean;
  memoryTtlDays: number;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  success: boolean;
  durationMs: number;
}

export interface CitationRecord {
  source: 'prisma' | 'yahoo' | 'coingecko' | 'computed' | 'tool';
  detail: string;
  asOf?: string;
  toolCallId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  /** Which model handled the main ReAct loop for this request */
  modelUsed: string;
  /** Complexity tier determined by the router */
  complexity: 'simple' | 'complex';
}

export interface AgentRunResult {
  message: string;
  toolCalls: ToolCallRecord[];
  citations: CitationRecord[];
  confidence: number;
  warnings: string[];
  tokenUsage: TokenUsage;
  newConversationId?: string;
}

let checkpointerInstance: RedisSaver | null = null;
let redisClient: ReturnType<typeof createClient> | null = null;

export async function getOrCreateCheckpointer(
  redisUrl: string,
  ttlDays: number
): Promise<RedisSaver> {
  if (checkpointerInstance) return checkpointerInstance;

  const client = createClient({ url: redisUrl });
  client.on('error', (err) =>
    console.error('[AgentGraph] Redis client error:', err)
  );

  try {
    await client.connect();
  } catch (err) {
    console.error('[AgentGraph] Redis connect() failed:', err);
    throw new Error(
      `Agent checkpointer unavailable: ${(err as Error).message}`
    );
  }

  redisClient = client;
  checkpointerInstance = new RedisSaver(redisClient, {
    defaultTTL: ttlDays * 24 * 60 * 60,
    refreshOnRead: true
  });

  return checkpointerInstance;
}

export async function closeCheckpointer(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    checkpointerInstance = null;
  }
}

function buildSystemPrompt(): string {
  return `You are a professional financial assistant integrated into Ghostfolio, a personal finance and portfolio management platform.

You help users understand their investment portfolio, analyze holdings, and answer financial questions.

Guidelines:
- Always cite the source of financial data (e.g., "according to your portfolio data as of [date]")
- Express uncertainty when appropriate — never fabricate numbers
- When presenting returns or values, note the currency
- You have access to the user's real portfolio data via tools — use them proactively
- For tax or legal questions, include appropriate disclaimers
- Keep responses concise but complete

Available tools:
- portfolio_analysis: Retrieve current portfolio holdings, allocation, and performance metrics
- market_data: Fetch current and historical market prices for specific ticker symbols
- transaction_categorize: Retrieve and categorize the user's transaction history (buys, sells, dividends, fees)
- tax_estimate: Provide a rough US tax estimate for a given year (mocked, informational only)
- compliance_check: Run US regulatory and best-practice compliance checks (informational only)

Always use tools to ground your answers in real data rather than making assumptions.`;
}

function calculateConfidence(
  toolCalls: ToolCallRecord[],
  verificationResults: VerificationResult[]
): number {
  if (toolCalls.length === 0) {
    return 0.5;
  }

  const successRate =
    toolCalls.filter((t) => t.success).length / toolCalls.length;
  const toolSuccessScore = successRate * 0.4;

  const verificationScore =
    verificationResults.length > 0
      ? (verificationResults.filter((v) => v.passed).length /
          verificationResults.length) *
        0.4
      : 0.4;

  // LLM validity: 0.2 if we got a non-empty response
  const llmScore = 0.2;

  return Math.min(1, toolSuccessScore + verificationScore + llmScore);
}

export async function runAgentGraph(
  query: string,
  threadId: string,
  portfolioService: PortfolioService,
  orderService: OrderService,
  dataProviderService: DataProviderService,
  userId: string,
  config: AgentGraphConfig
): Promise<AgentRunResult> {
  const checkpointer = await getOrCreateCheckpointer(
    config.redisUrl,
    config.memoryTtlDays
  );

  // Step 1: Route the query.
  // A lightweight Haiku call classifies which tools are needed and whether the
  // query is simple (single-tool lookup) or complex (multi-tool / analytical).
  // This costs ~$0.0001 and determines which model handles the ReAct loop.
  // On any router error, falls back safely to all tools + Sonnet.
  const routerResult = await routeQuery(query);
  const isSimple = routerResult.complexity === 'simple';

  // Step 2: Pick model and pricing based on complexity tier.
  const modelName = isSimple ? HAIKU_MODEL : SONNET_MODEL;
  const agentInputCostPerM = isSimple
    ? HAIKU_INPUT_COST_PER_M
    : SONNET_INPUT_COST_PER_M;
  const agentOutputCostPerM = isSimple
    ? HAIKU_OUTPUT_COST_PER_M
    : SONNET_OUTPUT_COST_PER_M;

  // Simple queries cap output at 1024 tokens — direct lookups never need 4096.
  const llm = new ChatAnthropic({
    model: modelName,
    temperature: 0,
    maxTokens: isSimple ? 1024 : 4096
  });

  // Step 3: Build all tools, then filter to only the ones the router identified.
  // Sending fewer tool schemas to the LLM reduces token overhead on every call.
  const allToolMap: Record<string, DynamicStructuredTool> = {
    portfolio_analysis: createPortfolioAnalysisTool(portfolioService, userId),
    market_data: createMarketDataTool(dataProviderService),
    transaction_categorize: createTransactionCategorizeTool(
      orderService,
      userId
    ),
    tax_estimate: createTaxEstimateTool(),
    compliance_check: createComplianceCheckTool()
  };

  const tools: DynamicStructuredTool[] = routerResult.tools
    .map((name) => allToolMap[name])
    .filter((t): t is DynamicStructuredTool => t !== undefined);

  const agent = createReactAgent({
    llm,
    tools: tools as any,
    checkpointSaver: checkpointer,
    messageModifier: buildSystemPrompt()
  });

  const toolCallsRecorded: ToolCallRecord[] = [];
  const verificationResults: VerificationResult[] = [];
  const warnings: string[] = [];

  const messages: BaseMessage[] = [new HumanMessage(query)];

  const agentConfig = {
    configurable: { thread_id: threadId },
    callbacks: config.langsmithTracingEnabled ? undefined : [],
    // Sanitized metadata sent to LangSmith — no raw PII
    metadata: {
      threadId: (traceSanitizer({ threadId }) as Record<string, unknown>)
        .threadId,
      toolCount: tools.length
    },
    runName: 'ghostfolio-agent-chat',
    tags: ['ghostfolio', 'finance-agent', 'v1']
  };

  const result = await agent.invoke({ messages }, agentConfig);

  // Parse tool calls from the message history
  for (const message of result.messages) {
    const msgType = (message as { _getType?: () => string })._getType?.();

    if (msgType === 'ai') {
      const aiMsg = message as {
        tool_calls?: Array<{
          id?: string;
          name: string;
          args: Record<string, unknown>;
        }>;
      };

      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        for (const tc of aiMsg.tool_calls) {
          toolCallsRecorded.push({
            name: tc.name,
            input: tc.args,
            success: true,
            durationMs: 0
          });
        }
      }
    }

    if (msgType === 'tool') {
      const toolMsg = message as {
        name?: string;
        content?: string;
        tool_call_id?: string;
      };

      if (toolMsg.name === 'portfolio_analysis' && toolMsg.content) {
        try {
          const parsed = JSON.parse(toolMsg.content);
          const validated = PortfolioAnalysisOutputSchema.safeParse(parsed);

          if (validated.success) {
            const verification = verifyPortfolioAnalysis(
              validated.data as PortfolioAnalysisOutput
            );
            verificationResults.push(verification);
            warnings.push(...verification.warnings);
          }
        } catch {
          // Non-JSON tool output; skip verification
        }
      }
    }
  }

  const lastMessage = result.messages[result.messages.length - 1];
  const responseText =
    typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  const citations: CitationRecord[] = toolCallsRecorded.map((tc) => ({
    source: 'tool' as const,
    detail: `Data retrieved via ${tc.name}`,
    asOf: new Date().toISOString()
  }));

  const confidence = calculateConfidence(
    toolCallsRecorded,
    verificationResults
  );

  if (confidence < 0.8) {
    warnings.push(
      `Confidence score ${(confidence * 100).toFixed(0)}% is below the 80% threshold. Please verify results independently.`
    );
  }

  // Extract token usage from AI messages (LangChain usage_metadata)
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const message of result.messages) {
    const msgType = (message as { _getType?: () => string })._getType?.();

    if (msgType === 'ai') {
      const usageMeta = (
        message as {
          usage_metadata?: { input_tokens?: number; output_tokens?: number };
        }
      ).usage_metadata;

      if (usageMeta) {
        totalInputTokens += usageMeta.input_tokens ?? 0;
        totalOutputTokens += usageMeta.output_tokens ?? 0;
      }
    }
  }

  // Cost accounting: router (always Haiku) + agent (Haiku or Sonnet) billed separately
  // because they run at different per-token rates. Both are included in reported totals.
  const routerCostUsd =
    (routerResult.routerInputTokens / 1_000_000) * HAIKU_INPUT_COST_PER_M +
    (routerResult.routerOutputTokens / 1_000_000) * HAIKU_OUTPUT_COST_PER_M;

  const agentCostUsd =
    (totalInputTokens / 1_000_000) * agentInputCostPerM +
    (totalOutputTokens / 1_000_000) * agentOutputCostPerM;

  const estimatedCostUsd = routerCostUsd + agentCostUsd;

  const reportedInputTokens = totalInputTokens + routerResult.routerInputTokens;
  const reportedOutputTokens =
    totalOutputTokens + routerResult.routerOutputTokens;

  const tokenUsage: TokenUsage = {
    inputTokens: reportedInputTokens,
    outputTokens: reportedOutputTokens,
    totalTokens: reportedInputTokens + reportedOutputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    modelUsed: modelName,
    complexity: routerResult.complexity
  };

  return {
    message: responseText,
    toolCalls: toolCallsRecorded,
    citations,
    confidence,
    warnings: [...new Set(warnings)],
    tokenUsage
  };
}
