import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '@/lib/db/client';
import { createFragment, getFragment, updateFragmentImage } from '@/lib/db/fragments';
import {
  countMediaReferences,
  createMedia,
  deleteMedia,
  getMedia,
  getMediaByHash,
  listMedia,
} from '@/lib/db/media';
import {
  MAX_MEDIA_BYTES,
  detectImageType,
  isMediaKey,
  localMediaPath,
  mediaKey,
  publicMediaUrl,
  readLocalMedia,
  sha256,
  writeLocalMedia,
} from '@/lib/media';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const gif = new TextEncoder().encode('GIF89a');
const webp = new Uint8Array([...'RIFF', 0, 0, 0, 0, ...'WEBP'].map((value) =>
  typeof value === 'string' ? value.charCodeAt(0) : value,
));
const avif = new Uint8Array([0, 0, 0, 0, ...new TextEncoder().encode('ftypavif')]);

let temp: string | null = null;

afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = null;
});

describe('media detection', () => {
  it('detects supported image formats from bytes', () => {
    expect(detectImageType(png)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectImageType(jpeg)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectImageType(gif)).toEqual({ mime: 'image/gif', ext: 'gif' });
    expect(detectImageType(webp)).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(detectImageType(avif)).toEqual({ mime: 'image/avif', ext: 'avif' });
  });

  it('rejects SVG, text and unknown data', () => {
    expect(detectImageType(new TextEncoder().encode('<svg></svg>'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('builds safe hash keys and public URLs', () => {
    const hash = sha256(png);
    const key = mediaKey(hash, 'png');
    expect(key).toBe(`${hash}.png`);
    expect(isMediaKey(key)).toBe(true);
    expect(isMediaKey('../secret.png')).toBe(false);
    expect(publicMediaUrl(key, { MEDIA_PUBLIC_BASE_URL: 'https://media.example.com/' })).toBe(
      `https://media.example.com/media/${key}`,
    );
    expect(publicMediaUrl(key, {})).toBe(`/media/${key}`);
  });
});

describe('media storage and database', () => {
  it('writes, reads and deduplicates a media record', async () => {
    temp = mkdtempSync(join(tmpdir(), 'josh-media-'));
    const env = { PORTAL_DATA_DIR: temp };
    const hash = sha256(png);
    const key = mediaKey(hash, 'png');
    await writeLocalMedia(key, png, env);
    expect(await readLocalMedia(key, env)).toEqual(png);
    expect(localMediaPath(key, env)).toBe(join(temp, 'media', key));

    const db = openDatabase(':memory:');
    try {
      const first = createMedia(db, 'local', {
        hash,
        mime: 'image/png',
        ext: 'png',
        bytes: png.byteLength,
        storageKey: key,
        publicUrl: `/media/${key}`,
      });
      expect(first.deduped).toBe(false);
      expect(first.media.hash).toBe(hash);

      const second = createMedia(db, 'local', {
        hash,
        mime: 'image/png',
        ext: 'png',
        bytes: png.byteLength,
        storageKey: key,
        publicUrl: `/media/${key}`,
      });
      expect(second.deduped).toBe(true);
      expect(second.media.id).toBe(first.media.id);
      expect(getMediaByHash(db, 'local', hash)?.id).toBe(first.media.id);

      const otherHash = sha256(jpeg);
      const otherKey = mediaKey(otherHash, 'jpg');
      createMedia(db, 'local', {
        hash: otherHash,
        mime: 'image/jpeg',
        ext: 'jpg',
        bytes: jpeg.byteLength,
        originalName: 'second.jpg',
        storageKey: otherKey,
        publicUrl: `/media/${otherKey}`,
      });

      const list = listMedia(db, 'local', { limit: 1 });
      expect(list.total).toBe(2);
      expect(list.totalBytes).toBe(png.byteLength + jpeg.byteLength);
      expect(list.media).toHaveLength(1);
      const all = listMedia(db, 'local', { limit: 10 }).media.map((item) => item.originalName);
      expect(all).toContain('second.jpg');
      expect(listMedia(db, 'local', { limit: 10, offset: 1 }).media).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('counts references, rewrites fragment images and deletes media', () => {
    const db = openDatabase(':memory:');
    try {
      const hash = sha256(png);
      const key = mediaKey(hash, 'png');
      const created = createMedia(db, 'local', {
        hash,
        mime: 'image/png',
        ext: 'png',
        bytes: png.byteLength,
        storageKey: key,
        publicUrl: `/media/${key}`,
      });
      const { fragment } = createFragment(db, 'local', {
        kind: 'image',
        quote: 'remote image',
        metadata: { image: { src: 'https://example.com/a.png', alt: 'a' } },
      });

      const updated = updateFragmentImage(db, 'local', fragment.id, {
        src: `/media/${key}`,
        remoteSrc: 'https://example.com/a.png',
        transferred: true,
      });
      expect((updated?.metadata.image as { src: string }).src).toBe(`/media/${key}`);
      expect((getFragment(db, 'local', fragment.id)?.metadata.image as { transferred: boolean }).transferred).toBe(true);
      expect(countMediaReferences(db, 'local', key)).toBe(1);
      expect(deleteMedia(db, 'local', created.media.id)).toBe(true);
      expect(getMedia(db, 'local', created.media.id)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('rejects keys that try to escape the media root', async () => {
    await expect(readLocalMedia('../../etc/passwd')).rejects.toThrow('Invalid media key.');
  });

  it('exposes the upload size limit', () => {
    expect(MAX_MEDIA_BYTES).toBe(20 * 1024 * 1024);
  });
});
