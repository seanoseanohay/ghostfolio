import { AgentRunResult, runAgentGraph } from '@ghostfolio/agent';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  public constructor(private readonly portfolioService: PortfolioService) {}

  public async chat({
    conversationId,
    query,
    userId
  }: {
    conversationId?: string;
    query: string;
    userId: string;
  }): Promise<AgentRunResult & { newConversationId: string }> {
    const resolvedConversationId = conversationId ?? randomUUID();
    const threadId = `agent:conversation:${userId}:${resolvedConversationId}`;

    const redisHost = process.env.REDIS_HOST ?? 'localhost';
    const redisPort = process.env.REDIS_PORT ?? '6379';
    const redisPassword = process.env.REDIS_PASSWORD;
    const redisDb = process.env.REDIS_DB ?? '0';

    const redisUrl = redisPassword
      ? `redis://:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}/${redisDb}`
      : `redis://${redisHost}:${redisPort}/${redisDb}`;

    const langsmithTracingEnabled =
      process.env.LANGSMITH_TRACING_ENABLED === 'true';

    const memoryTtlDays = parseInt(
      process.env.AGENT_MEMORY_TTL_DAYS ?? '7',
      10
    );

    this.logger.log(
      `Agent chat request — userId: ${userId.slice(0, 8)}… thread: ${threadId.slice(0, 32)}…`
    );

    try {
      const result = await runAgentGraph(
        query,
        threadId,
        this.portfolioService,
        userId,
        {
          redisUrl,
          langsmithTracingEnabled,
          memoryTtlDays
        }
      );

      return {
        ...result,
        newConversationId: resolvedConversationId
      };
    } catch (error) {
      this.logger.error(
        `Agent graph failed: ${(error as Error).message}`,
        (error as Error).stack
      );
      throw error;
    }
  }
}
