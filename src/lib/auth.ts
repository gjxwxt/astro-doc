import { timingSafeEqual } from 'node:crypto';

/**
 * Optional gate for the tool/chat API.
 *
 * - No PORTAL_API_TOKEN: everything is open, protected only by rate limits.
 * - Token set: MCP and curl must send `Authorization: Bearer <token>`, while
 *   the site's own UI is allowed through via Sec-Fetch-Site. This is not a
 *   strong security boundary (a script can forge the header); it exists to
 *   keep casual external use away from an expensive AI key.
 */
export function isAuthorized(request: Request, env: Record<string, string | undefined>): boolean {
  const token = env.PORTAL_API_TOKEN?.trim();
  if (!token) return true;

  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Bearer ')) {
    const provided = header.slice(7);
    const left = Buffer.from(provided);
    const right = Buffer.from(token);
    if (left.length === right.length && timingSafeEqual(left, right)) return true;
  }

  const site = request.headers.get('sec-fetch-site');
  return site === 'same-origin' || site === 'same-site';
}
