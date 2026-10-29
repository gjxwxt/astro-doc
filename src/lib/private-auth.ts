import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PRIVATE_OWNER_ID = 'local';
export const SESSION_COOKIE = 'josh_private_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

interface SessionPayload {
  sub: string;
  exp: number;
}

export interface PrivateAuth {
  ownerId: string;
  via: 'session' | 'token';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function safeEqual(left: string, right: string): boolean {
  const a = digest(left);
  const b = digest(right);
  return timingSafeEqual(a, b);
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

export function createSessionToken(secret: string, nowMs = Date.now()): string {
  const payload: SessionPayload = {
    sub: PRIVATE_OWNER_ID,
    exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): SessionPayload | null {
  const [encoded, signature, ...rest] = token.split('.');
  if (!encoded || !signature || rest.length > 0) return null;
  if (!safeEqual(signature, sign(encoded, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (!payload || typeof payload !== 'object') return null;
    const value = payload as Partial<SessionPayload>;
    if (value.sub !== PRIVATE_OWNER_ID || typeof value.exp !== 'number') return null;
    if (value.exp <= Math.floor(nowMs / 1000)) return null;
    return { sub: value.sub, exp: value.exp };
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

export function sessionFromRequest(
  request: Request,
  env: Record<string, string | undefined>,
  nowMs = Date.now(),
): SessionPayload | null {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) return null;
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  return verifySessionToken(token, secret, nowMs);
}

export function verifyAdminPassword(
  password: unknown,
  env: Record<string, string | undefined>,
): boolean {
  const expected = env.ADMIN_PASSWORD?.trim();
  if (!expected || typeof password !== 'string' || !password) return false;
  return safeEqual(password, expected);
}

export function authenticate(
  request: Request,
  env: Record<string, string | undefined>,
): PrivateAuth | null {
  const session = sessionFromRequest(request, env);
  if (session) return { ownerId: session.sub, via: 'session' };

  const token = env.PRIVATE_API_TOKEN?.trim();
  if (!token) return null;

  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const provided = header.slice(7).trim();
  if (!provided || !safeEqual(provided, token)) return null;
  return { ownerId: PRIVATE_OWNER_ID, via: 'token' };
}

export function isSecureRequest(
  request: Request,
  env: Record<string, string | undefined>,
): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === 'https';

  const site = env.SITE_URL?.trim();
  if (!site) return false;
  try {
    return new URL(site).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function getSession(
  request: Request,
  env: Record<string, string | undefined>,
  nowMs = Date.now(),
): SessionPayload | null {
  return sessionFromRequest(request, env, nowMs);
}
