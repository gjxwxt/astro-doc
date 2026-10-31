import type { DatabaseSync } from 'node:sqlite';

import { getFragment, updateFragment, type Fragment } from '@/lib/db/fragments';
import {
  createDraft,
  getDraft,
  restoreDraft,
  updateDraft,
  type Draft,
} from '@/lib/db/syntheses';

export interface DraftFromFragmentResult {
  draft: Draft;
  fragment: Fragment | null;
  created: boolean;
}

function slugify(value: string, id: string): string {
  const base = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'draft'}-${id.slice(0, 8)}`;
}

function titleOf(fragment: Fragment): string {
  const title = fragment.sourceTitle.trim() || fragment.quote.replace(/\s+/g, ' ').trim();
  return (title || '未命名草稿').slice(0, 80);
}

function imageOf(fragment: Fragment): { src: string; alt: string } | null {
  if (fragment.kind !== 'image') return null;
  const image = fragment.metadata.image;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  const value = image as Record<string, unknown>;
  const src = typeof value.src === 'string' ? value.src.trim() : '';
  if (!src) return null;
  const alt = typeof value.alt === 'string' && value.alt.trim() ? value.alt.trim() : '图片';
  return { src, alt };
}

function markdownOf(fragment: Fragment): string {
  const image = imageOf(fragment);
  const blocks: string[] = [];

  if (image) {
    blocks.push(`![${image.alt}](${image.src})`);
  } else if (fragment.kind === 'link' && fragment.sourceUrl) {
    blocks.push(`[${fragment.sourceTitle || fragment.sourceUrl}](${fragment.sourceUrl})`);
  } else if (fragment.quote) {
    blocks.push(fragment.quote);
  }

  if (fragment.note) blocks.push(fragment.note);

  if (fragment.sourceUrl && fragment.kind !== 'link') {
    blocks.push(`来源：[${fragment.sourceTitle || fragment.sourceUrl}](${fragment.sourceUrl})`);
  }

  return blocks.join('\n\n').trim();
}

/**
 * Turn one inbox fragment into a draft, without requiring a synthesis run.
 * The slug is deterministic, so double-clicking the action returns the same draft.
 */
export function createDraftFromFragment(
  db: DatabaseSync,
  ownerId: string,
  fragmentId: string,
): DraftFromFragmentResult | null {
  const fragment = getFragment(db, ownerId, fragmentId);
  if (!fragment) return null;

  const title = titleOf(fragment);
  const slug = slugify(title, fragment.id);
  const existing = db
    .prepare('SELECT id, deleted_at FROM drafts WHERE owner_id = ? AND slug = ? LIMIT 1')
    .get(ownerId, slug) as { id: string; deleted_at: string | null } | undefined;
  if (existing) {
    if (!existing.deleted_at) {
      return {
        draft: getDraft(db, ownerId, existing.id)!,
        fragment,
        created: false,
      };
    }
    // A soft-deleted draft still owns the unique slug; revive it instead of
    // failing on the unique index. Keep its old source mapping, refresh text.
    const restored = restoreDraft(db, ownerId, existing.id);
    const refreshed = restored
      ? updateDraft(db, ownerId, existing.id, {
          title,
          markdown: markdownOf(fragment),
          status: 'draft',
        })
      : null;
    if (refreshed) {
      const updated = updateFragment(db, ownerId, fragmentId, { status: 'archived' });
      return { draft: refreshed, fragment: updated, created: false };
    }
  }

  const draft = createDraft(db, ownerId, {
    synthesisRunId: null,
    title,
    slug,
    markdown: markdownOf(fragment),
    citations: [
      {
        token: `fragment-${fragment.id.slice(0, 8)}`,
        fragmentId: fragment.id,
        title: fragment.sourceTitle || '碎片',
        url: fragment.sourceUrl,
        quote: fragment.quote.slice(0, 500),
      },
    ],
  });
  const updated = updateFragment(db, ownerId, fragmentId, { status: 'archived' });
  return { draft, fragment: updated, created: true };
}
