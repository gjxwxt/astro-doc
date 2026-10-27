import { siteConfig } from '@/config/site';

import type { SearchHit } from './search';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface Source {
  title: string;
  url: string;
  description?: string;
  snippet?: string;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseHeaders(): HeadersInit {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
}

function config(env: Record<string, string | undefined>): AiConfig | null {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: env.AI_MODEL?.trim() || 'gpt-4o-mini',
  };
}

function sourcesFrom(hits: SearchHit[]): Source[] {
  return hits.map((hit) => ({
    title: hit.doc.title,
    url: hit.doc.url,
    description: hit.doc.description,
    snippet: hit.snippet,
  }));
}

function searchAnswer(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return '没有在站内找到相关的内容。可以试试直接打开 [工具](/tools/) 或 [笔记](/notes/)，或者换一个更具体的关键词。';
  }

  const lines = hits.slice(0, 5).map((hit) => {
    const description = hit.doc.description || hit.snippet || '';
    return `- [${hit.doc.title}](${hit.doc.url})${description ? `：${description.slice(0, 110)}` : ''}`;
  });

  return `当前没有配置 AI key，我先按站内检索给你结果：\n\n${lines.join('\n')}\n\n配置 \`AI_API_KEY\` 后可以获得生成式回答，检索结果仍然会作为来源附在下面。`;
}

function buildContext(hits: SearchHit[]): string {
  return hits
    .slice(0, 6)
    .map((hit, index) => {
      const body = (hit.doc.body ?? '').slice(0, 1600);
      return `[${index + 1}] ${hit.doc.title}\nURL: ${hit.doc.url}\n${hit.doc.description ?? ''}\n${body}`;
    })
    .join('\n\n');
}

function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message): message is ChatMessage =>
        Boolean(message) &&
        typeof message === 'object' &&
        (message as ChatMessage).role !== undefined &&
        ((message as ChatMessage).role === 'user' || (message as ChatMessage).role === 'assistant') &&
        typeof (message as ChatMessage).content === 'string',
    )
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 2000),
    }))
    .filter((message) => message.content.length > 0);
}

export async function createChatResponse(options: {
  request: Request;
  env: Record<string, string | undefined>;
  messages: unknown;
  hits: SearchHit[];
}): Promise<Response> {
  const messages = sanitizeMessages(options.messages);
  const ai = config(options.env);
  const sources = sourcesFrom(options.hits);

  if (!ai) {
    const text = searchAnswer(options.hits);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse('sources', { mode: 'search', sources }));
        controller.enqueue(sse('token', { text }));
        controller.enqueue(sse('done', { mode: 'search' }));
        controller.close();
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  }

  const controllerAbort = new AbortController();
  const abort = () => controllerAbort.abort();
  options.request.signal.addEventListener('abort', abort);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse('sources', { mode: 'ai', sources }));

      const system = [
        `你是「${siteConfig.name} 的个人门户」的站内助手。`,
        '只根据下面提供的站内资料回答；资料里没有的内容就说不知道，并建议用户打开工具或笔记页面。',
        '回答用中文，简洁，最多 5 句。引用站内页面时使用 Markdown 链接，例如 [标题](/notes/xxx/)。',
        '不要编造资料里没有的事实，不要提“资料”这个词。',
        '',
        '站内资料：',
        buildContext(options.hits),
      ].join('\n');

      try {
        const response = await fetch(`${ai.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${ai.apiKey}`,
          },
          body: JSON.stringify({
            model: ai.model,
            stream: true,
            temperature: 0.2,
            max_tokens: 900,
            messages: [{ role: 'system', content: system }, ...messages],
          }),
          signal: controllerAbort.signal,
        });

        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => '');
          controller.enqueue(
            sse('error', {
              message: `模型接口返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`,
            }),
          );
          controller.enqueue(sse('done', { mode: 'ai' }));
          controller.close();
          return;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const text = data.choices?.[0]?.message?.content ?? '';
          controller.enqueue(sse('token', { text }));
          controller.enqueue(sse('done', { mode: 'ai' }));
          controller.close();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const dataLine = chunk
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('');
            if (!dataLine || dataLine === '[DONE]') {
              boundary = buffer.indexOf('\n\n');
              continue;
            }
            try {
              const parsed = JSON.parse(dataLine) as {
                choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
              };
              const text =
                parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? '';
              if (text) {
                sent = true;
                controller.enqueue(sse('token', { text }));
              }
            } catch {
              /* ignore malformed upstream chunks */
            }
            boundary = buffer.indexOf('\n\n');
          }
        }

        if (!sent) controller.enqueue(sse('token', { text: '模型没有返回内容，请稍后再试。' }));
        controller.enqueue(sse('done', { mode: 'ai' }));
        controller.close();
      } catch (error) {
        if (!controllerAbort.signal.aborted) {
          controller.enqueue(
            sse('error', {
              message: error instanceof Error ? error.message : '生成失败，请稍后再试。',
            }),
          );
          controller.enqueue(sse('done', { mode: 'ai' }));
        }
        controller.close();
      } finally {
        options.request.signal.removeEventListener('abort', abort);
      }
    },
    cancel() {
      controllerAbort.abort();
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

export function hasAiKey(env: Record<string, string | undefined>): boolean {
  return Boolean(config(env));
}
