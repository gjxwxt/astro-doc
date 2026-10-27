import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { MusicSourceId } from './types';

interface TokenPayload {
  source: MusicSourceId;
  id: string;
  expires: number;
}

const VALID_SOURCES = new Set<MusicSourceId>(['gequhai', 'gequke', 'netease']);
const TOKEN_TTL = 45 * 60 * 1000;
const secret =
  process.env.MUSIC_TOKEN_SECRET?.trim() ||
  process.env.PORTAL_API_TOKEN?.trim() ||
  randomBytes(32).toString('hex');
const key = createHash('sha256').update(secret).digest();

export function signMusicToken(source: MusicSourceId, id: string): string {
  const payload: TokenPayload = {
    source,
    id,
    expires: Date.now() + TOKEN_TTL,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function verifyMusicToken(token: string): { source: MusicSourceId; id: string } | null {
  try {
    const packed = Buffer.from(token, 'base64url');
    if (packed.length < 12 + 16 + 1) return null;

    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain) as Partial<TokenPayload>;

    if (
      typeof payload.expires !== 'number' ||
      payload.expires < Date.now() ||
      typeof payload.id !== 'string' ||
      !/^\d+$/.test(payload.id) ||
      !payload.source ||
      !VALID_SOURCES.has(payload.source)
    ) {
      return null;
    }

    return { source: payload.source, id: payload.id };
  } catch {
    return null;
  }
}
