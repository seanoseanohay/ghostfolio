import {
  AgentClientService,
  AgentConversationItem,
  StoredMessage
} from '@ghostfolio/client/services/agent/agent.service';

import { TextFieldModule } from '@angular/cdk/text-field';
import { CommonModule, DatePipe } from '@angular/common';
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline,
  chatbubbleOutline,
  chatbubblesOutline,
  informationCircleOutline,
  sendOutline,
  trashOutline
} from 'ionicons/icons';
import { Subject, takeUntil } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  showDetails?: boolean;
  metadata?: StoredMessage['metadata'];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'page' },
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    IonIcon,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TextFieldModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-ai-chat-page',
  styleUrls: ['./ai-chat-page.component.scss'],
  templateUrl: './ai-chat-page.component.html'
})
export class GfAiChatPageComponent
  implements OnInit, OnDestroy, AfterViewChecked
{
  @ViewChild('messageContainer') public messageContainer: ElementRef;

  public activeConversationId: string | null = null;
  public conversations: AgentConversationItem[] = [];
  public isLoading = false;
  public isSidebarOpen = true;
  public messages: ChatMessage[] = [];
  public query = '';

  public readonly suggestions = [
    'What is my portfolio performance this year?',
    'Show my largest holdings',
    'How diversified is my portfolio?',
    'What are my recent transactions?'
  ];

  private shouldScrollToBottom = false;
  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private readonly agentService: AgentClientService,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {
    addIcons({
      addOutline,
      chatbubbleOutline,
      chatbubblesOutline,
      informationCircleOutline,
      sendOutline,
      trashOutline
    });
  }

  public ngOnInit() {
    this.loadConversations();
  }

  public ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  public onNewChat() {
    this.activeConversationId = null;
    this.messages = [];
    this.query = '';
  }

  public onSelectConversation(id: string) {
    if (this.activeConversationId === id) {
      return;
    }

    this.activeConversationId = id;
    this.messages = [];
    this.isLoading = true;
    this.changeDetectorRef.markForCheck();

    this.agentService
      .getConversation(id)
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (detail) => {
          this.messages = detail.messages.map((m) => ({
            content: m.content,
            metadata: m.metadata,
            role: m.role,
            timestamp: new Date(m.timestamp)
          }));
          this.isLoading = false;
          this.shouldScrollToBottom = true;
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  public onSend() {
    const trimmed = this.query.trim();
    if (!trimmed || this.isLoading) {
      return;
    }

    this.messages.push({
      content: trimmed,
      role: 'user',
      timestamp: new Date()
    });

    this.messages.push({
      content: '',
      isLoading: true,
      role: 'assistant',
      timestamp: new Date()
    });

    this.query = '';
    this.isLoading = true;
    this.shouldScrollToBottom = true;
    this.changeDetectorRef.markForCheck();

    this.agentService
      .chat(trimmed, this.activeConversationId ?? undefined)
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (response) => {
          this.messages = this.messages.filter((m) => !m.isLoading);
          this.messages.push({
            content: response.message,
            metadata: {
              citations: response.citations,
              confidence: response.confidence,
              toolCalls: response.toolCalls,
              tokenUsage: response.tokenUsage,
              warnings: response.warnings
            },
            role: 'assistant',
            timestamp: new Date()
          });

          if (!this.activeConversationId) {
            this.activeConversationId = response.newConversationId;
            this.loadConversations();
          } else {
            this.refreshConversationTimestamp(this.activeConversationId);
          }

          this.isLoading = false;
          this.shouldScrollToBottom = true;
          this.changeDetectorRef.markForCheck();
        },
        error: (err) => {
          this.messages = this.messages.filter((m) => !m.isLoading);
          this.messages.push({
            content:
              'Sorry, something went wrong. Please try again. ' +
              (err?.error?.detail ?? ''),
            role: 'assistant',
            timestamp: new Date()
          });
          this.isLoading = false;
          this.shouldScrollToBottom = true;
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  public onEnterKey(event: KeyboardEvent) {
    if (!event.shiftKey) {
      event.preventDefault();
      this.onSend();
    }
  }

  public onSuggestionClick(suggestion: string) {
    this.query = suggestion;
    this.onSend();
  }

  public toggleDetails(message: ChatMessage) {
    message.showDetails = !message.showDetails;
    this.changeDetectorRef.markForCheck();
  }

  public getConfidenceClass(confidence: number): string {
    if (confidence >= 0.8) {
      return 'high';
    } else if (confidence >= 0.6) {
      return 'medium';
    }
    return 'low';
  }

  private loadConversations() {
    this.agentService
      .getConversations()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (conversations) => {
          this.conversations = conversations;
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  private refreshConversationTimestamp(id: string) {
    const conv = this.conversations.find((c) => c.id === id);
    if (conv) {
      conv.updatedAt = new Date().toISOString();
      this.conversations = [
        conv,
        ...this.conversations.filter((c) => c.id !== id)
      ];
    }
  }

  private scrollToBottom() {
    if (this.messageContainer?.nativeElement) {
      this.messageContainer.nativeElement.scrollTop =
        this.messageContainer.nativeElement.scrollHeight;
    }
  }
}
