export interface AiRuntime {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function reasoningEffort(value: string | undefined): AiRuntime['reasoningEffort'] {
  const effort = value?.trim().toLowerCase();
  return effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high'
    ? effort
    : undefined;
}

export function aiRuntime(
  env: Record<string, string | undefined> = process.env,
): AiRuntime | null {
  if (env.AI_ENABLED === '0') return null;
  const apiKey = env.AI_API_KEY?.trim() || env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: env.AI_MODEL?.trim() || 'gpt-4o-mini',
    reasoningEffort: reasoningEffort(env.AI_REASONING_EFFORT),
  };
}

function timeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function upstreamError(response: Response): Promise<AiError> {
  const text = await response.text().catch(() => '');
  let message = '';
  try {
    const data = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    message =
      typeof data.error === 'string' ? data.error : data.error?.message || data.message || '';
  } catch {
    message = text.slice(0, 160);
  }
  return new AiError(`AI 接口返回 ${response.status}${message ? `：${message.slice(0, 160)}` : ''}`, response.status);
}

function canRetry(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function request(
  runtime: AiRuntime,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response> {
  let last: AiError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${runtime.apiKey}`,
        },
        body: JSON.stringify({
          model: runtime.model,
          ...body,
          ...(runtime.reasoningEffort ? { reasoning_effort: runtime.reasoningEffort } : {}),
        }),
        signal: timeoutSignal(options.signal, options.timeoutMs ?? 60_000),
      });
      if (response.ok) return response;
      const error = await upstreamError(response);
      last = error;
      if (attempt === 0 && canRetry(error.status)) {
        await wait(450, options.signal);
        continue;
      }
      throw error;
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      last = new AiError(error instanceof Error ? error.message : 'AI 请求失败');
      if (attempt === 0) {
        await wait(450, options.signal);
        continue;
      }
    }
  }
  throw last ?? new AiError('AI 请求失败');
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|markdown|md)?\s*\n?([\s\S]*?)\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

function contentFrom(data: unknown): string {
  const value = data as {
    choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
  };
  return value.choices?.[0]?.message?.content ?? value.choices?.[0]?.delta?.content ?? '';
}

export async function chatText(
  runtime: AiRuntime,
  input: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const response = await request(
    runtime,
    {
      stream: false,
      temperature: input.temperature ?? 0.35,
      max_tokens: input.maxTokens ?? 1_600,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    },
    { signal: input.signal, timeoutMs: 75_000 },
  );
  const data = (await response.json()) as unknown;
  return stripFence(contentFrom(data));
}

export function parseJsonObject<T>(text: string): T {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new AiError('AI 没有返回合法 JSON。');
  }
}

export async function chatJson<T>(
  runtime: AiRuntime,
  input: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  },
): Promise<T> {
  const text = await chatText(runtime, {
    ...input,
    temperature: input.temperature ?? 0.2,
    maxTokens: input.maxTokens ?? 1_600,
  });
  return parseJsonObject<T>(text);
}

export async function* chatTextStream(
  runtime: AiRuntime,
  input: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  },
): AsyncGenerator<string> {
  const response = await request(
    runtime,
    {
      stream: true,
      temperature: input.temperature ?? 0.45,
      max_tokens: input.maxTokens ?? 900,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    },
    { signal: input.signal, timeoutMs: 75_000 },
  );

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = (await response.json()) as unknown;
    const text = stripFence(contentFrom(data));
    if (text) yield text;
    return;
  }

  if (!response.body) throw new AiError('AI 没有返回内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sent = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');
        if (data && data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data) as unknown;
            const text = contentFrom(parsed);
            if (text) {
              sent = true;
              yield text;
            }
          } catch {
            /* ignore malformed upstream chunks */
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!sent) throw new AiError('AI 没有返回内容。');
}
