# Private triage loop — design

## Data flow

```
inbox fragment (ownerId)
        │
        ├── POST /api/fragments/:id/draft
        │       └── createDraftFromFragment()
        │              ├── find active draft by fragment citation
        │              ├── reuse, or revive soft-deleted slug owner
        │              ├── insert/update draft + citation
        │              └── archive source fragment
        │
        ├── POST /api/fragments/:id/merge
        │       └── mergeFragments(target, duplicate)
        │              ├── merge note + tags
        │              ├── metadata.mergedFrom (last 20)
        │              └── soft-delete duplicate
        │
        └── POST /api/fragments/bulk
                └── updateFragmentsStatus(ids, "archived")
                       └── one transaction, owner-scoped
```

## Key files

- `src/lib/triage.ts` — orchestrates draft creation and archiving.
- `src/lib/db/fragments.ts` — fragments, `updateFragmentsStatus`,
  `mergeFragments`.
- `src/lib/db/syntheses.ts` — `createDraft`, draft lookup/restore/update.
- `src/pages/api/fragments/[id]/draft.ts` — rate-limited endpoint.
- `src/pages/api/fragments/[id]/merge.ts` — rate-limited endpoint.
- `src/pages/api/fragments/bulk.ts` — rate-limited endpoint.
- `src/pages/organize.astro` — UI state, optimistic-but-confirmed updates.
- `src/styles/private.css` — triage layout and burn animation.
- `tests/triage.test.ts` — the regression suite for this spec.

## Draft creation

1. Load the fragment by `(id, ownerId)` and reject if missing.
2. Look for an active draft whose citation contains `fragment-<id8>`.
3. If found, return `{ draft, created: false }` without side effects.
4. Derive a slug base from the fragment title, falling back to the first line,
   then `draft`; append the first 8 characters of the fragment UUID.
5. If the slug is held by a soft-deleted draft, restore it and update content.
   Otherwise insert a new draft.
6. Archive the fragment in the same transaction as the draft write.
7. Return the draft and `created: true`.

The unique index on `drafts.slug` is the reason step 5 exists; it is a schema
constraint, not an error to surface to the user.

## Merge

- The target and duplicate are loaded with the owner predicate.
- Note: append the duplicate note when it is not already present.
- Tags: union, stable order, deduplicated.
- `metadata.mergedFrom`: append duplicate ID, keep the last 20.
- Soft-delete the duplicate; do not move its media automatically.
- Return the updated target and the duplicate ID for UI removal.

## Bulk archive

- Validate `ids.length` between 1 and 100.
- Validate `status` is `archived` or `inbox`.
- Use one `UPDATE ... WHERE id IN (...) AND ownerId = ?` inside a transaction.
- Return `{ updated }`; the UI adds the bulk button count to the total removed.

## UI behaviour

- A single-flight lock per card and per bulk action.
- The card gets `is-busy`; buttons disable.
- On success: remove the row, decrement the inbox count, clear selection.
- On failure: remove `is-busy`, keep the row, show `删除失败，请重试。` or
  `操作失败，请重试。`.
- Delete/burn: wait for the server response before starting the burn; if the
  request fails, remove `is-burning` and keep the card.
- Reduced motion: skip `scrap-burn`; set opacity to 0 over 120ms.

## Security and limits

- All endpoints require the private auth middleware and use `ownerId`.
- Rate limit: 30 requests/minute per owner/IP for draft, merge and bulk.
- No fragment text in logs; errors return codes/messages, not rows.
- `metadata.mergedFrom` is bounded to avoid unbounded JSON growth.

## Test plan

| Case | Expected |
| --- | --- |
| Create draft twice for one fragment | second call returns existing draft |
| Delete draft, create again | soft-deleted draft is revived; slug unchanged |
| Merge B into A | A keeps tags/note; B is soft-deleted; `mergedFrom` records B |
| Merge another owner’s fragment | 404/not found; no rows change |
| Bulk archive 2 of 3 | exactly 2 updated; third unchanged |
| Bulk with 101 IDs | 400; no rows change |
| Reduced motion delete | no burn animation; 120ms opacity transition |
