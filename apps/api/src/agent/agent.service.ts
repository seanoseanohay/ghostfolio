import { AgentRunResult, runAgentGraph } from '@ghostfolio/agent';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { subDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    toolCalls: {
      name: string;
      input: Record<string, unknown>;
      success: boolean;
      durationMs: number;
    }[];
    confidence: number;
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
    citations: { source: string; detail: string; asOf?: string }[];
    warnings: string[];
  };
}

export interface AgentConversationItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConversationDetail extends AgentConversationItem {
  messages: StoredMessage[];
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  public constructor(
    private readonly dataProviderService: DataProviderService,
    private readonly orderService: OrderService,
    private readonly portfolioService: PortfolioService,
    private readonly prismaService: PrismaService
  ) {}

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

    // Append user message to conversation before calling the agent
    await this.upsertConversation({
      conversationId: resolvedConversationId,
      newMessage: {
        role: 'user',
        content: query,
        timestamp: new Date().toISOString()
      },
      query,
      userId
    });

    try {
      const result = await runAgentGraph(
        query,
        threadId,
        this.portfolioService,
        this.orderService,
        this.dataProviderService,
        userId,
        {
          redisUrl,
          langsmithTracingEnabled,
          memoryTtlDays
        }
      );

      this.logger.log(
        `Agent response — tokens: ${result.tokenUsage.totalTokens} (in: ${result.tokenUsage.inputTokens}, out: ${result.tokenUsage.outputTokens}), cost: $${result.tokenUsage.estimatedCostUsd.toFixed(6)}, confidence: ${(result.confidence * 100).toFixed(0)}%`
      );

      // Persist assistant response
      await this.upsertConversation({
        conversationId: resolvedConversationId,
        newMessage: {
          role: 'assistant',
          content: result.message,
          timestamp: new Date().toISOString(),
          metadata: {
            toolCalls: result.toolCalls,
            confidence: result.confidence,
            tokenUsage: result.tokenUsage,
            citations: result.citations,
            warnings: result.warnings
          }
        },
        userId
      });

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

  public async getConversations(
    userId: string
  ): Promise<AgentConversationItem[]> {
    const memoryTtlDays = parseInt(
      process.env.AGENT_MEMORY_TTL_DAYS ?? '7',
      10
    );

    // Clean up expired conversations (TTL matches Redis checkpointer)
    await this.prismaService.agentConversation.deleteMany({
      where: { userId, updatedAt: { lt: subDays(new Date(), memoryTtlDays) } }
    });

    const conversations = await this.prismaService.agentConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { createdAt: true, id: true, title: true, updatedAt: true },
      where: { userId }
    });

    return conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString()
    }));
  }

  public async getConversation(
    userId: string,
    conversationId: string
  ): Promise<AgentConversationDetail> {
    const conversation = await this.prismaService.agentConversation.findFirst({
      where: { id: conversationId, userId }
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const messages = Array.isArray(conversation.messages)
      ? (conversation.messages as unknown as StoredMessage[])
      : [];

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages
    };
  }

  private async upsertConversation({
    conversationId,
    newMessage,
    query,
    userId
  }: {
    conversationId: string;
    newMessage: StoredMessage;
    query?: string;
    userId: string;
  }): Promise<void> {
    const existing = await this.prismaService.agentConversation.findFirst({
      where: { id: conversationId, userId }
    });

    if (existing) {
      const messages = Array.isArray(existing.messages)
        ? (existing.messages as unknown as StoredMessage[])
        : [];

      const updatedMessages = [...messages, newMessage];

      await this.prismaService.agentConversation.update({
        data: { messages: updatedMessages as unknown as Prisma.InputJsonValue },
        where: { id: conversationId }
      });
    } else {
      // New conversation — auto-generate title from first user query
      const title = query
        ? query.slice(0, 60).trim() + (query.length > 60 ? '…' : '')
        : 'New conversation';

      await this.prismaService.agentConversation.create({
        data: {
          id: conversationId,
          messages: [newMessage] as unknown as Prisma.InputJsonValue,
          title,
          user: { connect: { id: userId } }
        }
      });
    }
  }
}
