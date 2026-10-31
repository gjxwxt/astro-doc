---
inclusion: always
---

# Technical steering

## Runtime and toolchain

- Node **>= 22.23.4**; the repo `.nvmrc` is `24`. Astro 7 refuses to start on
  22.23.2. Run `nvm use` before installing.
- **pnpm 11** is locked by `packageManager`.
- Astro 7 + Starlight for pages/content; Node adapter for API routes.
- No Tailwind, React, shadcn or client framework runtime. CSS is hand-written
  under `src/styles/`.
- Database is SQLite through `node:sqlite`; no ORM.

## Commands

```bash
pnpm check        # astro check + MCP tsc + vitest
pnpm build        # prerender, API routes, sitemap, Pagefind
pnpm mcp:build    # after MCP/manifest changes
pnpm test         # vitest only
```

Run `pnpm check` after code changes and `pnpm build` before shipping. UI changes
also need a manual look at `/`, `/notes/`, `/tools/music/`, `/bookmarks/`,
`/docs/`, `/inbox`, `/organize`, `/drafts` and `/media` where relevant.

## Architecture rules

- **Static first.** Pages are prerendered unless they need secrets, runtime data
  or cross-origin proxying.
- **One search implementation** in `src/lib/search.ts`; pages, `/api/search`
  and AI retrieval all use it.
- **One plugin schema.** The manifest drives API validation, MCP tool schemas
  and the tools UI. Do not duplicate field definitions in the MCP server.
- **MCP does not import site code.** It talks to the portal over HTTP.
- **AI keys stay server-side.** The browser calls `/api/chat`; without a key the
  retrieval-only mode must still work.
- **One adapter per music source** under `src/lib/music/`; never accept arbitrary
  audio URLs from the client.
- **Auth**: Bearer `PRIVATE_API_TOKEN` or HttpOnly `josh_private_session`; login
  uses `ADMIN_PASSWORD`. Owner-scoped queries always include `ownerId`.

## Safety

- Every external request needs a timeout. For binary responses, check
  content-type and size.
- `media` fetches only public http(s) URLs; do not turn it into a general SSRF
  proxy.
- Do not log tokens, cookies, passwords or private fragment text.
- Do not commit `.env*`, `data/`, local plugin configs or generated media.

## Data

- DB: `PORTAL_DATA_DIR/portal.sqlite`.
- Media: `PORTAL_DATA_DIR/media/<sha256>.<ext>`, content-addressed.
- Public media base: `MEDIA_PUBLIC_BASE_URL`, normally
  `https://media.gaojiaxiang.cn/media`.
- Backups: `PORTAL_BACKUP_DIR/<YYYYMMDD-HHMMSS>/{portal.sqlite,media.tar.gz,manifest.json}`.

See `docs/BACKUP.md`, `docs/DEPLOYMENT.md` and `docs/PHASE-2.md` before changing
deployment or data behaviour.
