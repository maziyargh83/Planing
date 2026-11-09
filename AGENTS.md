# Gaam — guide for agents working on this codebase

Gaam (گام) is a personal planner that AI agents drive over MCP. This file is for agents that **change Gaam's code**. If you only want to **use** Gaam as a planner, read [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md). It is also served over MCP as the `gaam_guide` tool and the `gaam://guide` resource.

`CLAUDE.md` is a symlink to this file, so Claude Code, Codex and Cursor all read the same copy.

## Commands

| Command | Does |
| --- | --- |
| `pnpm install` | Install dependencies. Requires Node 24 or later. |
| `pnpm dev` | Run the API server with `--watch` on 4777 and Vite on 4778 (which proxies `/api` and `/mcp`). |
| `pnpm start` | Build the UI and serve everything on http://localhost:4777. |
| `pnpm mcp` | Start the stdio MCP server, which is what Claude Code and Codex launch. |
| `pnpm test` | Run the MCP end-to-end tests (`node --test`, in-memory database). |
| `pnpm typecheck` | Type-check the server (`tsconfig.json`) and the web UI (`web/tsconfig.json`). |
| `GAAM_DB=~/.gaam/demo.db pnpm seed` | Fill an **empty** scratch database with a realistic example. |

The user's real data is in `~/.gaam/gaam.db`. Never run the seed or experiments against it. Set `GAAM_DB` to a scratch file instead.

## Architecture

```
src/core/db.ts            node:sqlite, migrations (pragma user_version), FTS5 triggers
src/core/types.ts         enums and row types, shared with the web UI
src/core/planner.ts       Planner — the domain layer. Every write goes through it and logs an event.
src/core/coach.ts         insights(), nudges(), context(): read-only analytics
src/integrations/         jira.ts, git.ts (local git, GitLab, GitHub)
src/mcp/server.ts         createMcpServer(): tools, resources, prompts
src/mcp/prompts.ts        workflow prompts (idea_to_plan, plan_my_day, …)
src/mcp/stdio.ts          stdio entry point
src/server/main.ts        Hono: /api/rpc, /api/stream (SSE), /mcp (stateless HTTP), static UI
web/src/                  SolidJS, RTL Persian UI; api.ts calls Planner methods through /api/rpc
docs/AGENT_GUIDE.md       how agents should use Gaam (served over MCP)
```

How it works:

- **One domain layer.** The UI, HTTP MCP and stdio MCP all call `Planner`. Business rules live there, never in a tool handler or a component.
- **Actor.** `new Planner(db, actor)` records who acted. The UI is `me`. Stdio MCP uses the client's name. HTTP MCP uses `?as=` or the `x-gaam-actor` header.
- **Live UI.** Every write inserts a row into `events`. `/api/stream` polls that table and pushes SSE, so writes from a separate stdio process still show up live.
- **No build step on the server.** Node runs `.ts` directly through type stripping, so use only erasable syntax: no `enum`, no `namespace`, no parameter properties. Write relative imports with the `.ts` extension, and use `import type` for types.

## Adding a feature

1. Add a schema change as a **new** entry in `MIGRATIONS` in `db.ts`. Never edit an old migration; they are forward-only and the user's database already ran them. If the new table should be searchable, add it to `INDEXED`.
2. Add a `Planner` method. It must validate references (resolve them or throw `GaamError("NOT_FOUND", …)` with a hint about which tool to call) and call `this.log(...)`.
3. Expose it as an MCP tool in `server.ts`. The tool description is the only documentation the agent sees, so say when to use the tool and what the fields mean. Mark read-only tools by passing `true` as the last argument to `tool(...)`.
4. If the UI needs the method, add its name to `PLANNER_METHODS` in `src/server/main.ts`.
5. Update [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) if the change affects how agents should behave.
6. Extend `src/mcp/server.test.ts`, then run `pnpm test` and `pnpm typecheck`.

## UI: Park UI on Panda CSS

- The design system is **Park UI** (Ark UI for Solid with Panda CSS recipes): sand gray, amber accent. Components live in `web/src/components/ui` and theme files in `web/src/theme`. Both were added with the Park CLI, run from `web/` (`npx @park-ui/cli add <name>`). Keep them as the CLI writes them.
- Panda generates `web/styled-system`. `pnpm build` and `prepare` run `panda codegen`. `staticCss: { recipes: "*" }` is required, because Panda cannot trace recipe variants through the Park wrappers.
- Dark mode is the `.dark` class on `<html>`, set by `web/src/theme-mode.ts` (system, light or dark). The legacy CSS variables in `styles.css` (`--panel`, `--accent`, and so on) point at Panda tokens, so older markup follows the theme.
- Never use `window.prompt` or `window.confirm`. Use `ask()` and `confirmAction()` from `web/src/kit.tsx`. They are Park dialogs, with suggestion chips for people and dates.
- Quick capture: `web/src/capture.ts` parses one Persian or English line into a task, follow-up, meeting, lesson, decision, memory or idea. Persian names are matched to English names by consonant skeleton. Its tests are in `web/src/capture.test.ts`.

## Conventions

- Tabs for indentation, double quotes, and short comments that explain why, not what.
- UI copy is Persian and uses ZWNJ correctly (می‌شود, پروژه‌ها). Keys, code and identifiers are English. Show numbers with `fa()` and dates with `jalali()` from `web/src/api.ts`.
- The UI is RTL. Use logical CSS properties (`inset-inline-*`, `margin-inline-*`, `border-inline-*`) and colour tokens from `:root` in `styles.css`. The layout must work at 375px wide with no horizontal scroll.
- Keep dependencies minimal. Runtime dependencies are `hono`, `@hono/node-server`, `@modelcontextprotocol/sdk` and `zod`, and adding another needs a real reason.
- Bind the server to 127.0.0.1. The origin check in `main.ts` blocks requests from other sites, so do not loosen it.
