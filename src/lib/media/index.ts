import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MEDIA_KEY_RE = /^[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif|avif)$/;

export const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export const EXTENSION_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

export interface DetectedImage {
  mime: string;
  ext: string;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/**
 * Sniff common web image formats instead of trusting the browser-provided MIME.
 * SVG is intentionally not accepted: an SVG served from our public media route
 * can execute script when opened directly.
 */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') {
      return { mime: 'image/avif', ext: 'avif' };
    }
  }
  return null;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function mediaKey(hash: string, ext: string): string {
  return `${hash}.${ext}`;
}

export function isMediaKey(key: string): boolean {
  return MEDIA_KEY_RE.test(key);
}

export function mimeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIMES[ext] ?? 'application/octet-stream';
}

export function mediaRoot(env: Record<string, string | undefined> = process.env): string {
  const dir = env.PORTAL_DATA_DIR?.trim() || resolve(process.cwd(), 'data');
  return join(dir, 'media');
}

export function localMediaPath(
  key: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (!isMediaKey(key)) throw new Error('Invalid media key.');
  return join(mediaRoot(env), key);
}

export function publicMediaUrl(
  key: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const base = env.MEDIA_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/media/${key}` : `/media/${key}`;
}

export async function writeLocalMedia(
  key: string,
  bytes: Uint8Array,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const target = localMediaPath(key, env);
  await mkdir(mediaRoot(env), { recursive: true, mode: 0o700 });
  const temp = join(mediaRoot(env), `.${key}.${randomUUID()}.tmp`);
  await writeFile(temp, bytes, { mode: 0o600 });
  try {
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function readLocalMedia(
  key: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(localMediaPath(key, env)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
