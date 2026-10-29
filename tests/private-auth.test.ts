import { describe, expect, it } from 'vitest';

import {
  authenticate,
  createSessionToken,
  getSession,
  parseCookies,
  sessionFromRequest,
  verifyAdminPassword,
  verifySessionToken,
} from '@/lib/private-auth';

const env = {
  ADMIN_PASSWORD: 'correct horse battery staple',
  SESSION_SECRET: 'test-secret-that-is-long-enough',
  PRIVATE_API_TOKEN: 'private-token',
};

describe('private auth', () => {
  it('signs and verifies a session token', () => {
    const token = createSessionToken(env.SESSION_SECRET, 1_700_000_000_000);
    const payload = verifySessionToken(token, env.SESSION_SECRET, 1_700_000_000_000);
    expect(payload?.sub).toBe('local');
    expect(payload?.exp).toBeGreaterThan(1_700_000_000);
  });

  it('rejects tampered and expired tokens', () => {
    const token = createSessionToken(env.SESSION_SECRET, 1_700_000_000_000);
    expect(verifySessionToken(`${token}x`, env.SESSION_SECRET, 1_700_000_000_000)).toBeNull();
    expect(verifySessionToken(token, 'another-secret', 1_700_000_000_000)).toBeNull();
    expect(verifySessionToken(token, env.SESSION_SECRET, 1_700_000_000_000 + 31 * 24 * 3600 * 1000)).toBeNull();
  });

  it('reads a session from the cookie header', () => {
    const token = createSessionToken(env.SESSION_SECRET, 1_700_000_000_000);
    const request = new Request('http://localhost/inbox', {
      headers: { cookie: `theme=dark; josh_private_session=${token}` },
    });
    expect(sessionFromRequest(request, env, 1_700_000_000_000)?.sub).toBe('local');
    expect(getSession(request, env, 1_700_000_000_000)?.sub).toBe('local');
    expect(parseCookies('a=1; b=2').b).toBe('2');
  });

  it('accepts the static token and rejects a wrong one', () => {
    const request = new Request('http://localhost/api/fragments', {
      headers: { authorization: `Bearer ${env.PRIVATE_API_TOKEN}` },
    });
    expect(authenticate(request, env)).toEqual({ ownerId: 'local', via: 'token' });

    const wrong = new Request('http://localhost/api/fragments', {
      headers: { authorization: 'Bearer nope' },
    });
    expect(authenticate(wrong, env)).toBeNull();
  });

  it('checks the admin password without exposing it', () => {
    expect(verifyAdminPassword('correct horse battery staple', env)).toBe(true);
    expect(verifyAdminPassword('wrong', env)).toBe(false);
    expect(verifyAdminPassword('', env)).toBe(false);
  });
});
