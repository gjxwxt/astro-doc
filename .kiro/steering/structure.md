---
inclusion: fileMatch
fileMatchPattern: "src/**,tests/**,scripts/**,extension/**,obsidian-plugin/**,utools-plugin/**,packages/**"
---

# Repo map

## Portal

- `src/pages/inbox.astro` — capture form, fragment list, delete/burn interaction.
- `src/pages/organize.astro` — triage UI: summary, tags, duplicate merge, bulk
  archive, draft creation.
- `src/pages/api/fragments/` — private fragment APIs. `[id]/draft.ts`,
  `[id]/merge.ts` and `bulk.ts` are the triage endpoints.
- `src/pages/api/auth/` — login/logout/session.
- `src/lib/db/` — SQLite access. `fragments.ts`, `syntheses.ts`, `drafts.ts`.
- `src/lib/triage.ts` — create a draft from a fragment, idempotently; archive
  the source fragment.
- `src/lib/synthesis/ai.ts`, `src/lib/organize.ts`, `src/lib/review.ts` — AI
  suggestions, triage and review.
- `src/lib/auth.ts` — Bearer/cookie rules and owner resolution.
- `src/styles/tokens.css`, `private.css`, `portal.css` — design tokens and UI.

## Capture surfaces

- `extension/` — Chrome MV3 extension; `popup.html`, `background.js`,
  `batch.js`, and the page-selection overlay in `src/explosion.js`.
- `obsidian-plugin/josh-media/` — Obsidian plugin; `main.js`.
- `utools-plugin/josh-capture/` — uTools plugin; `app.js`, `index.html`.

## Data and ops

- `scripts/backup-db.ts` — `VACUUM INTO` snapshot, media tarball, manifest.
- `scripts/restore-db.ts` — restore DB and optionally media, with safety copies.
- `scripts/pull-backups.sh` — pull remote backups over SSH.
- `packages/mcp-server/src/index.ts` — stdio MCP server; registers portal tools.
- `docs/BACKUP.md`, `docs/DEPLOYMENT.md`, `docs/PHASE-2.md`.

## Tests

- `tests/triage.test.ts` — draft reuse, soft-deleted draft revival, merge and
  bulk status.
- `tests/db.test.ts`, `tests/private-auth.test.ts`, `tests/media.test.ts`,
  `tests/organize.test.ts`, `tests/synthesis.test.ts` — data/auth/AI behaviour.
- Test DBs are in-memory or temporary; never use the live `data/` directory.
