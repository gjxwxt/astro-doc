#!/usr/bin/env node
/**
 * Live Gemini smoke test. Reads a key from the environment or local .env files.
 * Never prints the key. Costs a fraction of a cent.
 */
import { loadEnvFile } from 'node:process';

for (const file of ['.env.local', '.env']) {
  try {
    loadEnvFile(file);
  } catch {
    /* missing file is fine */
  }
}

const key = (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '').trim();
const model = (process.env.GEMINI_TEST_MODEL || process.env.AI_MODEL || 'gemini-3.8-flash').trim();
const fallback = (process.env.AI_FALLBACK_MODEL || 'gemini-3.5-flash-lite').trim();
const base = 'https://generativelanguage.googleapis.com/v1beta';
const timeout = 60_000;

function textFromNative(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

function usage(data) {
  const u = data?.usageMetadata;
  if (!u) return '';
  return `prompt=${u.promptTokenCount ?? '?'} output=${u.candidatesTokenCount ?? '?'} thought=${u.thoughtsTokenCount ?? 0} total=${u.totalTokenCount ?? '?'}`;
}

async function timed(label, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`✔ ${label} (${Date.now() - start}ms)`);
    return result;
  } catch (error) {
    console.log(`✘ ${label} (${Date.now() - start}ms): ${error.message}`);
    throw error;
  }
}

if (!key) {
  console.error('缺少 key：把 GEMINI_API_KEY 或 AI_API_KEY 放进 .env.local / .env，或先 export。');
  process.exit(1);
}

console.log(`key: ${process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'AI_API_KEY'} (${key.length} chars)`);
console.log(`model: ${model}`);
console.log(`fallback: ${fallback}`);

const nativeBody = {
  contents: [{ parts: [{ text: '用一句话说明：低思考强度适合做什么？' }] }],
  generationConfig: {
    thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false },
    temperature: 0.2,
    maxOutputTokens: 256,
  },
};

try {
  const native = await timed('native generateContent + thinkingLevel=LOW', async () => {
    const response = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(nativeBody),
      signal: AbortSignal.timeout(timeout),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${response.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data;
  });
  console.log(`  text: ${textFromNative(native).slice(0, 160) || '（空）'}`);
  console.log(`  usage: ${usage(native) || '（无 usageMetadata）'}`);

  const compat = await timed('OpenAI compat stream + reasoning_effort=low', async () => {
    const response = await fetch(`${base}/openai/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.2,
        max_tokens: 128,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: '用一句话说明：这个接口能用吗？' }],
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${response.status} ${detail.slice(0, 300)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let chunks = 0;
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
        if (dataLine && dataLine !== '[DONE]') {
          try {
            const parsed = JSON.parse(dataLine);
            const piece = parsed?.choices?.[0]?.delta?.content ?? '';
            if (piece) {
              answer += piece;
              chunks += 1;
            }
          } catch {
            /* ignore malformed chunk */
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    return { answer: answer.trim(), chunks };
  });
  console.log(`  chunks: ${compat.chunks}`);
  console.log(`  text: ${compat.answer.slice(0, 160) || '（空）'}`);
  console.log('\n通过：原生低思考和公开助手兼容层都能用。');
} catch (error) {
  if (String(error.message).includes('402')) {
    console.error('\n402：预付款/额度仍为空。先在 AI Studio 充值，再重跑。');
  } else if (String(error.message).includes('403')) {
    console.error('\n403：key 无效或项目无权限；确认 key 属于已开通计费的项目。');
  } else if (String(error.message).includes('404')) {
    console.error('\n404：模型名不可用；先确认 AI Studio 里该模型对你的项目开放。');
  }
  process.exit(1);
}
