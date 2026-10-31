# .kiro

Project context for [Kiro](https://kiro.dev). Everything here is committed so a
new Kiro session starts with the same product rules, technical constraints and
feature history as the repo.

## What lives here

| Path | Purpose |
| --- | --- |
| `steering/` | Always-on project rules: product, stack, repo map and verification gate. |
| `specs/` | Requirements → design → tasks for the two features that close the product loop. |
| `hooks/` | A user-triggered hook that asks Kiro to run the full verification gate. |
| `agents/` | `portal-reviewer`, a read-only review agent for this repo. |
| `settings/mcp.json` | Kiro MCP wiring for the portal's own `portal-mcp` server. |

## Using it

1. Open this repo in Kiro. Trust the workspace when prompted so workspace
   steering, hooks, agents and MCP servers load.
2. Use the built-in agent for implementation, or select `portal-reviewer` from
   the agent picker for a review-only pass.
3. The review agent only reads files and runs verification commands. It does not
   edit the repo.
4. The `verify-change` hook is **user-triggered**: it appears in the hook list
   and, when run, asks Kiro to execute `pnpm check` and explain failures.

## MCP

`settings/mcp.json` starts the project's own MCP server with:

```bash
pnpm --filter @portal/mcp-server dev
```

The server reads `PORTAL_URL` and the API tokens from its environment. The
checked-in config points at the local dev server and contains **no secrets**;
put real tokens in your shell or a local, ignored file before using private
tools.

If the portal is not running, the MCP server still exposes its search/read
tools; start the portal for the private inbox tools.

## Specs

The specs are not invented marketing copy. They describe the shipped triage
loop and backup/restore flow, including the edge cases that already have tests:

- `private-triage-loop` — fragment → draft, duplicate merge, bulk archive.
- `backup-restore` — SQLite snapshot, media archive, manifest, restore.

Tasks marked `[x]` are implemented in this repo. Unchecked tasks are deliberate
follow-ups, not missing claims.

## What is deliberately not here

- No `powers/` directory: no Power is required to build or run the project.
- No secrets, tokens, local media or machine-specific absolute paths.
- No generated `dist/` output.
