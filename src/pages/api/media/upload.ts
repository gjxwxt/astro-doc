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

function decodeFileName(raw: string | null): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

interface UploadPayload {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

async function readUpload(request: Request): Promise<UploadPayload | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const form = await request.formData();
    const file = formFile(form);
    if (!file) return null;
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name.slice(0, 200),
      mime: file.type,
    };
  }

  if (
    contentType.startsWith('image/') ||
    contentType.startsWith('application/octet-stream')
  ) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return {
      bytes,
      filename: decodeFileName(request.headers.get('x-file-name')),
      mime: contentType.split(';', 1)[0]?.trim() || 'application/octet-stream',
    };
  }

  return null;
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

  let upload: UploadPayload | null;
  try {
    upload = await readUpload(request);
  } catch {
    return jsonError(400, 'INVALID_UPLOAD', '上传内容不合法。');
  }
  if (!upload) {
    return jsonError(
      415,
      'UNSUPPORTED_UPLOAD',
      '请用 multipart/form-data 的 file 字段，或直接发送 image/* 二进制并带 X-File-Name。',
    );
  }

  const { bytes } = upload;
  if (bytes.byteLength === 0) return jsonError(400, 'EMPTY_FILE', '图片是空的。');
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    return jsonError(413, 'IMAGE_TOO_LARGE', '图片不能超过 20MB。');
  }
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
      originalName: upload.filename,
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
