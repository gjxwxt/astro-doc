---
inclusion: always
---

# Verification gate

Do not call a change complete until this passes:

```bash
pnpm check
pnpm build
```

`pnpm check` runs Astro type checking, the MCP TypeScript check and the Vitest
suite. `pnpm build` must produce the prerendered site, API routes, sitemap and
Pagefind index.

## For UI changes

- Screenshot or manually inspect the affected private pages at 1920×1080 and a
  narrow viewport.
- Check empty, loading, error and long-content states.
- Confirm destructive actions (delete/burn, merge, archive, restore) are
  reversible or explicitly confirmed.
- Honour `prefers-reduced-motion`; motion should only animate transform/opacity.

## For data changes

- Add a migration or an idempotent schema guard; never drop user data silently.
- Add a test for owner scoping and for the soft-delete/restore path.
- Verify `PRAGMA integrity_check` after a backup/restore change.

## For AI changes

- Keep retrieval-only mode working when `AI_ENABLED=false` or the key is missing.
- External calls need a timeout and a rules fallback.
- Never send private data to a third party without an explicit product decision.

## For capture plugin changes

- Run the extension build and `pnpm mcp:build` if the manifest changes.
- Test the capture path against a local portal, not production.
- Do not put tokens in extension/plugin source or committed config.

## Reporting

When reporting a failure, include the command, the first actionable error and
the files touched. Do not claim success from a partial test run.
