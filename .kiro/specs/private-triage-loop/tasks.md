# Private triage loop — tasks

## 1. Data layer

- [x] 1.1 Add `updateFragmentsStatus(db, ownerId, ids, status)` with a 100-ID cap and one transaction.
- [x] 1.2 Add `mergeFragments(db, ownerId, targetId, duplicateId)` preserving target tags/note and recording `metadata.mergedFrom`.
- [x] 1.3 Keep all fragment lookups owner-scoped.
- [x] 1.4 Add a regression test for merge and bulk status.

## 2. Draft creation

- [x] 2.1 Add `createDraftFromFragment(db, ownerId, fragmentId)`.
- [x] 2.2 Reuse an active draft with a `fragment-<id8>` citation.
- [x] 2.3 Revive a soft-deleted draft that owns the generated slug.
- [x] 2.4 Archive the source fragment after a successful draft write.
- [x] 2.5 Add `POST /api/fragments/[id]/draft` with auth and a 30/min limit.
- [x] 2.6 Add tests for reuse and soft-deleted revival.

## 3. Merge and bulk APIs

- [x] 3.1 Add `POST /api/fragments/[id]/merge` with auth and a 30/min limit.
- [x] 3.2 Add `POST /api/fragments/bulk` with auth, 1–100 IDs and a 30/min limit.
- [x] 3.3 Return counts and updated IDs; never return private fragment bodies in errors.

## 4. Triage UI

- [x] 4.1 Add per-card draft, merge, archive and delete actions.
- [x] 4.2 Add select-all, selected count and bulk archive.
- [x] 4.3 Keep the inbox total in sync after single and bulk removal.
- [x] 4.4 Disable actions while a request is in flight.
- [x] 4.5 Preserve the card on failure and show a retryable message.
- [x] 4.6 Wire the existing burn animation to a confirmed delete only.
- [x] 4.7 Add `prefers-reduced-motion` behaviour for the burn.

## 5. Verification

- [x] 5.1 `pnpm check` passes (Astro check + MCP tsc + Vitest).
- [x] 5.2 `pnpm build` passes.
- [x] 5.3 Manually check `/inbox` and `/organize` at desktop and narrow widths.
- [x] 5.4 Check the draft appears in `/drafts` with its citation and source.
