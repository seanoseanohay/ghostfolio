import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface AgentChatResponse {
  message: string;
  toolCalls: {
    name: string;
    input: Record<string, unknown>;
    success: boolean;
    durationMs: number;
  }[];
  citations: { source: string; detail: string; asOf?: string }[];
  confidence: number;
  warnings: string[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  newConversationId: string;
}

export interface AgentConversationItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

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

export interface AgentConversationDetail extends AgentConversationItem {
  messages: StoredMessage[];
}

@Injectable({
  providedIn: 'root'
})
export class AgentClientService {
  public constructor(private readonly http: HttpClient) {}

  public chat(
    query: string,
    conversationId?: string
  ): Observable<AgentChatResponse> {
    return this.http.post<AgentChatResponse>('/api/v1/agent/chat', {
      query,
      conversationId
    });
  }

  public getConversations(): Observable<AgentConversationItem[]> {
    return this.http.get<AgentConversationItem[]>(
      '/api/v1/agent/conversations'
    );
  }

  public getConversation(id: string): Observable<AgentConversationDetail> {
    return this.http.get<AgentConversationDetail>(
      `/api/v1/agent/conversations/${id}`
    );
  }
}
