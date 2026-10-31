/**
 * RARE-INTELLIGENCE — Python engine HTTP client.
 *
 * The Python engine (python_engine/) cannot run on Vercel: serverless
 * functions have no long-running process, no persistent disk, and a bundle
 * size limit that a GGUF weight file exceeds by orders of magnitude. So the
 * engine runs as its own service and this client is the only thing the
 * TypeScript app uses to reach it.
 *
 * The wire contract is defined by python_engine/rare_engine/service.py and
 * documented in python_engine/INTEGRATION_CONTRACT.md. Both sides are tested
 * against the same shapes.
 */

export interface PythonEngineConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

export interface EngineHealth {
  ok: boolean;
  version: string;
  modelId: string;
  adapter: string;
  modelReady: boolean;
  detail: string;
  uptimeS: number;
}

export interface EngineRunResult {
  taskId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  result: string | null;
  steps: number;
  durationS: number;
  totalTokens: number;
  error: string | null;
  errorCode: string | null;
  resumedFromStep: number | null;
}

export interface EngineTaskSummary {
  taskId: string;
  goal: string;
  status: string;
  steps: number;
  updatedAt: string;
}

export interface EngineSearchHit {
  docId: string;
  source: string;
  score: number;
  text: string;
}

export interface EngineSearchResult {
  query: string;
  hits: EngineSearchHit[];
  totalIndexed: number;
}

/** Error carrying the engine's structured error code, not just a message. */
export class EngineClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(`[${code}] (${status}): ${message}`);
    this.name = 'EngineClientError';
    this.code = code;
    this.status = status;
  }
}

// --- wire shapes (snake_case on the wire, camelCase in TS) -----------------

interface RawHealth {
  ok: boolean;
  version: string;
  model_id: string;
  adapter: string;
  model_ready: boolean;
  detail: string;
  uptime_s: number;
}

interface RawRunResult {
  task_id: string;
  status: EngineRunResult['status'];
  result: string | null;
  steps: number;
  duration_s: number;
  total_tokens: number;
  error: string | null;
  error_code: string | null;
  resumed_from_step: number | null;
}

interface RawTaskSummary {
  task_id: string;
  goal: string;
  status: string;
  steps: number;
  updated_at: string;
}

interface RawSearchHit {
  doc_id: string;
  source: string;
  score: number;
  text: string;
}

interface RawSearchResult {
  query: string;
  hits: RawSearchHit[];
  total_indexed: number;
}

export class PythonEngineClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: PythonEngineConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'RARE-INTELLIGENCE-PyEngineClient/1.0',
          ...(init.headers || {}),
        },
      });

      const text = await res.text();
      let body: any = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }

      if (!res.ok) {
        // FastAPI puts structured errors under `detail`.
        const detail = body?.detail;
        const code = typeof detail === 'object' ? detail?.code : undefined;
        const message =
          typeof detail === 'object'
            ? detail?.message
            : typeof detail === 'string'
              ? detail
              : res.statusText;
        throw new EngineClientError(code || 'HTTP_ERROR', message || 'request failed', res.status);
      }

      return body as T;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new EngineClientError(
          'TIMEOUT',
          `request to ${path} exceeded ${this.timeoutMs}ms`,
          0,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Liveness + model readiness. Unauthenticated on the engine side. */
  public async health(): Promise<EngineHealth> {
    const raw = await this.request<RawHealth>('/health');
    return {
      ok: raw.ok,
      version: raw.version,
      modelId: raw.model_id,
      adapter: raw.adapter,
      modelReady: raw.model_ready,
      detail: raw.detail,
      uptimeS: raw.uptime_s,
    };
  }

  /** Run one task to a terminal state. Blocks until the engine finishes. */
  public async runTask(
    goal: string,
    options?: { modelId?: string; metadata?: Record<string, unknown>; taskId?: string },
  ): Promise<EngineRunResult> {
    const raw = await this.request<RawRunResult>('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        goal,
        model_id: options?.modelId ?? null,
        metadata: options?.metadata ?? {},
        task_id: options?.taskId,
      }),
    });
    return this.mapRun(raw);
  }

  /** Continue an interrupted task from its last persisted step. */
  public async resumeTask(taskId: string): Promise<EngineRunResult> {
    const raw = await this.request<RawRunResult>(
      `/v1/tasks/${encodeURIComponent(taskId)}/resume`,
      { method: 'POST' },
    );
    return this.mapRun(raw);
  }

  public async getTask(taskId: string): Promise<EngineRunResult> {
    const raw = await this.request<RawRunResult>(`/v1/tasks/${encodeURIComponent(taskId)}`);
    return this.mapRun(raw);
  }

  public async listTasks(limit = 50): Promise<EngineTaskSummary[]> {
    const raw = await this.request<RawTaskSummary[]>(`/v1/tasks?limit=${limit}`);
    return raw.map((t) => ({
      taskId: t.task_id,
      goal: t.goal,
      status: t.status,
      steps: t.steps,
      updatedAt: t.updated_at,
    }));
  }

  public async search(
    query: string,
    options?: { topK?: number; namespace?: string },
  ): Promise<EngineSearchResult> {
    const raw = await this.request<RawSearchResult>('/v1/memory/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        top_k: options?.topK ?? 5,
        namespace: options?.namespace ?? null,
      }),
    });
    return {
      query: raw.query,
      hits: raw.hits.map((h) => ({
        docId: h.doc_id,
        source: h.source,
        score: h.score,
        text: h.text,
      })),
      totalIndexed: raw.total_indexed,
    };
  }

  public async remember(text: string, key?: string): Promise<string> {
    const raw = await this.request<{ doc_id: string }>('/v1/memory/remember', {
      method: 'POST',
      body: JSON.stringify({ text, key: key ?? null }),
    });
    return raw.doc_id;
  }

  private mapRun(raw: RawRunResult): EngineRunResult {
    return {
      taskId: raw.task_id,
      status: raw.status,
      result: raw.result,
      steps: raw.steps,
      durationS: raw.duration_s,
      totalTokens: raw.total_tokens,
      error: raw.error,
      errorCode: raw.error_code,
      resumedFromStep: raw.resumed_from_step,
    };
  }
}
