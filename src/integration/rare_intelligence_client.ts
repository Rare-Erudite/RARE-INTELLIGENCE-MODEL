/**
 * RARE-INTELLIGENCE — Official TypeScript / Node.js Integration Client
 * Provides strong typed interface for client applications connecting to RARE-INTELLIGENCE.
 */

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface EngineStatus {
  isEngineRunning: boolean;
  isAiProviderReady: boolean;
  operationalState: string;
  activeProvider: string;
  isOnline: boolean;
  summaryMessage: string;
  availableProviders: Array<{
    id: string;
    name: string;
    modelIdentifier: string;
    isAvailable: boolean;
    isConfigured: boolean;
    statusMessage: string;
  }>;
}

export interface ChatMessage {
  role: 'user' | 'model' | 'system';
  content: string;
}

export interface ChatResponse {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  isSimulated: boolean;
  tokenUsage?: {
    totalTokens: number;
  };
}

export class RareIntelligenceClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs || 30000;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-API-Key': this.apiKey,
          'Accept': 'application/json',
          'User-Agent': 'RARE-INTELLIGENCE-TSClient/1.0',
          ...(options.headers || {}),
        },
      });
      clearTimeout(timer);

      const json = await res.json() as any;
      if (!res.ok) {
        const err = json.error || {};
        throw new Error(`[${err.code || 'HTTP_ERROR'}] (${res.status}): ${err.message || res.statusText}`);
      }
      return json as T;
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('[TIMEOUT_OR_CANCELLED] Request timed out waiting for RARE-INTELLIGENCE server.');
      }
      throw err;
    }
  }

  public async getHealth(): Promise<EngineStatus> {
    const data = await this.request<{ health: any }>('/api/v1/engine/health');
    const h = data.health;
    const activeProvider = h.availableProviders?.find((p: any) => p.id === h.activeProvider);
    return {
      isEngineRunning: true,
      isAiProviderReady: Boolean(activeProvider?.isAvailable),
      operationalState: h.operationalState,
      activeProvider: h.activeProvider,
      isOnline: h.isOnline,
      summaryMessage: h.operationalReport?.summaryMessage || 'Engine running.',
      availableProviders: h.availableProviders || [],
    };
  }

  public async chat(messages: ChatMessage[], options?: { temperature?: number; maxOutputTokens?: number; systemInstruction?: string }): Promise<ChatResponse> {
    const data = await this.request<{ result: ChatResponse }>('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, options }),
    });
    return data.result;
  }

  public async planTask(objective: string, constraints: string[] = []): Promise<any> {
    const data = await this.request<{ plan: any }>('/api/v1/tasks/plan', {
      method: 'POST',
      body: JSON.stringify({ objective, constraints }),
    });
    return data.plan;
  }

  public async enqueueTask(objective: string, networkDependency = 'local_only', constraints: string[] = []): Promise<any> {
    const data = await this.request<{ task: any }>('/api/v1/queue/enqueue', {
      method: 'POST',
      body: JSON.stringify({ objective, networkDependency, constraints }),
    });
    return data.task;
  }

  public async createConversation(title?: string, metadata?: Record<string, unknown>): Promise<{ id: string; conversation: any }> {
    const data = await this.request<{ success: boolean; id: string; conversation: any }>('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, metadata }),
    });
    return { id: data.id, conversation: data.conversation };
  }

  public async getConversation(id: string): Promise<any> {
    const data = await this.request<{ success: boolean; conversation: any }>(`/api/v1/conversations/${id}`);
    return data.conversation;
  }

  public async renameConversation(id: string, title: string): Promise<any> {
    const data = await this.request<{ success: boolean; conversation: any }>(`/api/v1/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    return data.conversation;
  }

  public async getConversationMessages(id: string): Promise<any[]> {
    const data = await this.request<{ success: boolean; messages: any[] }>(`/api/v1/conversations/${id}/messages`);
    return data.messages;
  }

  public async listConversations(): Promise<any[]> {
    const data = await this.request<{ success: boolean; conversations: any[] }>('/api/v1/conversations');
    return data.conversations;
  }

  public async deleteConversation(id: string): Promise<boolean> {
    const data = await this.request<{ success: boolean; deleted: boolean }>(`/api/v1/conversations/${id}`, {
      method: 'DELETE',
    });
    return data.deleted;
  }

  public async sendMessageToConversation(
    conversationId: string,
    message: string,
    options?: { temperature?: number; maxOutputTokens?: number; systemInstruction?: string }
  ): Promise<{ message: any; result: ChatResponse }> {
    const data = await this.request<{ success: boolean; message: any; result: ChatResponse }>(
      `/api/v1/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ message, options }),
      }
    );
    return { message: data.message, result: data.result };
  }

  public async loadLocalModel(): Promise<{ success: boolean; manifest: any }> {
    const data = await this.request<{ success: boolean; manifest: any }>('/api/v1/providers/load-local', {
      method: 'POST',
    });
    return data;
  }
}
