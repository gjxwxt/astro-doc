import { describe, expect, it } from 'vitest';

import { signMusicToken, verifyMusicToken } from '../src/lib/music/token';

describe('music download tokens', () => {
  it('encodes and verifies a source without exposing it', () => {
    const token = signMusicToken('gequhai', '326');
    expect(token).not.toContain('gequhai');
    expect(token).not.toContain('326');
    expect(verifyMusicToken(token)).toEqual({ source: 'gequhai', id: '326' });
  });

  it('rejects tampered and malformed tokens', () => {
    const token = signMusicToken('netease', '123');
    expect(verifyMusicToken(`${token}x`)).toBeNull();
    expect(verifyMusicToken('not-a-token')).toBeNull();
  });
});
