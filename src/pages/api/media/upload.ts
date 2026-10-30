import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { createMedia, getMediaByHash } from '@/lib/db/media';
import {
  MAX_MEDIA_BYTES,
  detectImageType,
  mediaKey,
  publicMediaUrl,
  sha256,
  writeLocalMedia,
} from '@/lib/media';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

const MAX_FORM_BYTES = MAX_MEDIA_BYTES + 2 * 1024 * 1024;

function formFile(form: FormData): File | null {
  const direct = form.get('file');
  if (direct instanceof File) return direct;
  const multiple = form.getAll('files').find((value): value is File => value instanceof File);
  return multiple ?? null;
}

export const POST: APIRoute = async ({ request }) => {
  const auth = authenticate(request, process.env);
  if (!auth) {
    return jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。');
  }

  const limit = rateLimit(clientKey(request, 'media:upload'), 30, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '上传太频繁，稍后再试。');

  const driver = process.env.MEDIA_DRIVER?.trim() || 'local';
  if (driver !== 'local') {
    return jsonError(503, 'MEDIA_DRIVER_UNSUPPORTED', `当前尚未配置 ${driver} 存储。`);
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
    return jsonError(413, 'IMAGE_TOO_LARGE', '图片不能超过 20MB。');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'INVALID_FORM_DATA', '上传表单不合法。');
  }

  const file = formFile(form);
  if (!file) {
    return jsonError(400, 'FILE_REQUIRED', '请用 multipart/form-data 的 file 字段上传图片。');
  }
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', '图片是空的。');
  if (file.size > MAX_MEDIA_BYTES) {
    return jsonError(413, 'IMAGE_TOO_LARGE', '图片不能超过 20MB。');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) {
    return jsonError(
      415,
      'UNSUPPORTED_IMAGE',
      '只支持 PNG、JPEG、WebP、GIF、AVIF。SVG 暂不支持。',
    );
  }

  const hash = sha256(bytes);
  const db = getDatabase();
  const existing = getMediaByHash(db, auth.ownerId, hash);
  if (existing) {
    return jsonOk({
      id: existing.id,
      url: existing.publicUrl,
      hash: existing.hash,
      mime: existing.mime,
      bytes: existing.bytes,
      deduped: true,
    });
  }

  const key = mediaKey(hash, detected.ext);
  const url = publicMediaUrl(key);
  try {
    await writeLocalMedia(key, bytes);
    const { media, deduped } = createMedia(db, auth.ownerId, {
      hash,
      mime: detected.mime,
      ext: detected.ext,
      bytes: bytes.byteLength,
      originalName: file.name.slice(0, 200),
      storageDriver: 'local',
      storageKey: key,
      publicUrl: url,
    });
    return jsonOk(
      {
        id: media.id,
        url: media.publicUrl,
        hash: media.hash,
        mime: media.mime,
        bytes: media.bytes,
        deduped,
      },
      deduped ? 200 : 201,
    );
  } catch (error) {
    console.error('[media:upload]', error);
    return jsonError(500, 'UPLOAD_FAILED', '图片保存失败。');
  }
};

export const OPTIONS: APIRoute = () => preflight();
