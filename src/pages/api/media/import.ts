import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { getFragment, updateFragmentImage } from '@/lib/db/fragments';
import { createMedia, getMediaByHash } from '@/lib/db/media';
import {
  detectImageType,
  mediaKey,
  publicMediaUrl,
  sha256,
  writeLocalMedia,
} from '@/lib/media';
import { authenticate } from '@/lib/private-auth';
import { asRecord, jsonError, jsonOk, preflight, readJson } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { RemoteImageError, downloadRemoteImage } from '@/lib/remote-image';

export const prerender = false;

const MEDIA_PATH_RE = /\/media\/[a-f0-9]{64}\.(?:png|jpe?g|webp|gif|avif)$/i;

function isManagedMediaUrl(value: string): boolean {
  try {
    return MEDIA_PATH_RE.test(new URL(value, 'https://media.invalid').pathname);
  } catch {
    return false;
  }
}

function imageSrcFromMetadata(metadata: Record<string, unknown> | null): string {
  const image = metadata?.image;
  if (image && typeof image === 'object' && !Array.isArray(image)) {
    const src = (image as Record<string, unknown>).src;
    if (typeof src === 'string' && src.trim()) return src.trim();
  }
  return '';
}

export const POST: APIRoute = async ({ request }) => {
  const auth = authenticate(request, process.env);
  if (!auth) {
    return jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。');
  }

  const limit = rateLimit(clientKey(request, 'media:import'), 10, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '转存太频繁，稍后再试。');

  const driver = process.env.MEDIA_DRIVER?.trim() || 'local';
  if (driver !== 'local') {
    return jsonError(503, 'MEDIA_DRIVER_UNSUPPORTED', `当前尚未配置 ${driver} 存储。`);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const input = asRecord(body.value);
  const fragmentId = typeof input.fragmentId === 'string' ? input.fragmentId.trim() : '';
  const explicitUrl = typeof input.url === 'string' ? input.url.trim() : '';

  const db = getDatabase();
  let fragment = fragmentId ? getFragment(db, auth.ownerId, fragmentId) : null;
  if (fragmentId && !fragment) return jsonError(404, 'NOT_FOUND', '找不到这条碎片。');
  if (fragment && fragment.kind !== 'image') {
    return jsonError(400, 'NOT_IMAGE', '这条碎片不是图片。');
  }

  const rawSrc = fragment ? imageSrcFromMetadata(fragment.metadata) : explicitUrl;
  if (!rawSrc) return jsonError(400, 'NO_IMAGE_URL', '没有找到要转存的图片地址。');
  if (isManagedMediaUrl(rawSrc)) {
    return jsonError(409, 'ALREADY_MANAGED', '这张图片已经在半亩媒体库里。');
  }

  let remote;
  try {
    remote = await downloadRemoteImage(rawSrc);
  } catch (error) {
    if (error instanceof RemoteImageError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error('[media:import]', error);
    return jsonError(502, 'FETCH_FAILED', '远程图片读取失败。');
  }

  const detected = detectImageType(remote.bytes);
  if (!detected) {
    return jsonError(415, 'UNSUPPORTED_IMAGE', '只支持 PNG、JPEG、WebP、GIF、AVIF。');
  }

  const hash = sha256(remote.bytes);
  const existing = getMediaByHash(db, auth.ownerId, hash);
  let media = existing;
  let deduped = Boolean(existing);

  if (!media) {
    const key = mediaKey(hash, detected.ext);
    const url = publicMediaUrl(key);
    const baseName =
      remote.filename.replace(/\.[a-z0-9]{1,8}$/i, '').slice(0, 100) || 'remote-image';
    try {
      await writeLocalMedia(key, remote.bytes);
      const created = createMedia(db, auth.ownerId, {
        hash,
        mime: detected.mime,
        ext: detected.ext,
        bytes: remote.bytes.byteLength,
        originalName: `${baseName}.${detected.ext}`,
        storageDriver: 'local',
        storageKey: key,
        publicUrl: url,
      });
      media = created.media;
      deduped = created.deduped;
    } catch (error) {
      console.error('[media:import] save failed', error);
      return jsonError(500, 'IMPORT_FAILED', '图片保存失败。');
    }
  }

  const url = publicMediaUrl(media.storageKey);
  if (fragment) {
    fragment = updateFragmentImage(db, auth.ownerId, fragment.id, {
      src: url,
      remoteSrc: rawSrc,
      transferred: true,
    });
    if (!fragment) return jsonError(500, 'UPDATE_FAILED', '图片已转存，但碎片更新失败。');
  }

  return jsonOk({
    id: media.id,
    url,
    mime: media.mime,
    bytes: media.bytes,
    deduped,
    fragmentId: fragment?.id ?? null,
  });
};

export const OPTIONS: APIRoute = () => preflight();
