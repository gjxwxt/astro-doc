import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import {
  DuplicateFragmentError,
  FragmentError,
  createFragment,
  updateLinkPreview,
  type FragmentInput,
} from '@/lib/db/fragments';
import {
  LinkPreviewError,
  fallbackLinkPreview,
  fetchLinkPreview,
  type LinkPreview,
} from '@/lib/link-preview';
import { authenticate } from '@/lib/private-auth';
import { asRecord, jsonError, jsonOk, preflight, readJson } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function previewMetadata(preview: LinkPreview): Record<string, unknown> {
  return {
    preview: {
      title: preview.title,
      description: preview.description,
      image: preview.image,
      video: preview.video,
      siteName: preview.siteName,
      author: preview.author,
      publishedAt: preview.publishedAt,
      articleUrl: preview.articleUrl,
      provider: preview.provider,
      finalUrl: preview.finalUrl,
    },
  };
}

export const POST: APIRoute = async ({ request }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'fragments:link'), 20, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '保存链接太频繁，稍后再试。');

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const input = asRecord(body.value);
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) return jsonError(400, 'INVALID_INPUT', '请提供链接。');

  let preview: LinkPreview;
  try {
    preview = await fetchLinkPreview(url, process.env);
  } catch (error) {
    if (error instanceof LinkPreviewError && error.code === 'INVALID_URL') {
      return jsonError(400, 'INVALID_URL', error.message);
    }
    // A network block or an anti-bot page should not prevent capture.
    preview = fallbackLinkPreview(url);
  }

  try {
    const fragment = createFragment(getDatabase(), auth.ownerId, {
      kind: 'link',
      quote: preview.finalUrl || preview.url,
      note: typeof input.note === 'string' ? input.note : '',
      sourceUrl: preview.finalUrl || preview.url,
      sourceTitle: preview.title,
      sourceSite: preview.siteName || sourceHost(preview.finalUrl || preview.url),
      capturedAt: typeof input.capturedAt === 'string' ? input.capturedAt : undefined,
      tags: Array.isArray(input.tags) ? (input.tags as string[]) : undefined,
      metadata: previewMetadata(preview),
    } satisfies FragmentInput);

    return jsonOk(fragment.fragment, fragment.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof DuplicateFragmentError) {
      // Re-pasting the same URL is also the natural way to refresh a stale
      // preview. Never replace a good card with a fallback card.
      if (!preview.fallback) {
        const refreshed = updateLinkPreview(getDatabase(), auth.ownerId, error.fragmentId, {
          sourceTitle: preview.title,
          sourceSite: preview.siteName || sourceHost(preview.finalUrl || preview.url),
          metadata: previewMetadata(preview),
        });
        if (refreshed) return jsonOk(refreshed, 200);
      }
      return jsonError(409, 'DUPLICATE', error.message, { fragmentId: error.fragmentId });
    }
    if (error instanceof FragmentError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error('[fragments:link]', error);
    return jsonError(500, 'INTERNAL_ERROR', '保存链接失败。');
  }
};

export const OPTIONS: APIRoute = () => preflight();
