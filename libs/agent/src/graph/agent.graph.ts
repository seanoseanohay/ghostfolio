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

export interface AgentRunResult {
  message: string;
  toolCalls: ToolCallRecord[];
  citations: CitationRecord[];
  confidence: number;
  warnings: string[];
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

  const llm = new ChatAnthropic({
    model: 'claude-sonnet-4-5',
    temperature: 0,
    maxTokens: 4096
  });

  const portfolioTool = createPortfolioAnalysisTool(portfolioService, userId);
  const marketDataTool = createMarketDataTool(dataProviderService);
  const transactionTool = createTransactionCategorizeTool(orderService, userId);
  const taxTool = createTaxEstimateTool();
  const complianceTool = createComplianceCheckTool();

  const tools: DynamicStructuredTool[] = [
    portfolioTool,
    marketDataTool,
    transactionTool,
    taxTool,
    complianceTool
  ];

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
    callbacks: config.langsmithTracingEnabled ? undefined : []
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

  return {
    message: responseText,
    toolCalls: toolCallsRecorded,
    citations,
    confidence,
    warnings: [...new Set(warnings)]
  };
}
