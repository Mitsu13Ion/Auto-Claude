# AGENTS.md

RiverCode is a customized fork of Aperant/Auto-Claude. It is a TypeScript-first Electron desktop app with a Vercel AI SDK v6 agent runtime in `apps/desktop/src/main/ai/` and an optional Python Graphiti sidecar.

This file is intentionally shorter than `CLAUDE.md`. Use it as the fast-path guidance for autonomous task agents.

## Priorities

1. Keep RiverCode stable and safe.
2. Preserve RiverCode-specific branding and behavior.
3. Minimize upstream merge pain.
4. Prefer small, testable changes over broad refactors.

## Fork Guardrails

- Keep user-facing branding as `RiverCode`.
- Keep internal `.auto-claude/` paths unless the task is explicitly about migrating them.
- Avoid unnecessary diffs in prompts, workflow files, and cross-cutting branding churn.
- Assume upstream sync comes from `upstream/develop` and prefer conflict-minimizing changes.
- Main development branch is `rivercode/main`.

## Critical Rules

- Use the Vercel AI SDK v6 patterns already present in `apps/desktop/src/main/ai/`. Do not introduce new direct provider-runtime flows when the existing provider/session stack can be reused.
- All renderer-facing text must go through i18n. Update both `apps/desktop/src/shared/i18n/locales/en/` and `apps/desktop/src/shared/i18n/locales/fr/`.
- Use platform helpers from `apps/desktop/src/main/platform/` instead of `process.platform`.
- Do not add `console.log` to production paths. Reuse existing logging, task logs, and error surfaces.
- Treat credentials, tokens, provider metadata, MCP settings, and file paths as sensitive. Never log secrets.
- Prefer bounded loops, explicit failure states, persisted diagnostics, and conservative recovery paths. Do not hide task failures behind silent fallbacks.

## High-Risk Areas

Inspect these areas carefully before changing behavior:

- Task pipeline: `apps/desktop/src/main/ai/orchestration/`
- Worker/session runtime: `apps/desktop/src/main/ai/agent/`, `apps/desktop/src/main/ai/session/`
- Task state + IPC: `apps/desktop/src/main/ipc-handlers/task/`, `apps/desktop/src/main/task-state-manager.ts`
- Claude auth/profile flow: `apps/desktop/src/main/terminal/`, `apps/desktop/src/main/claude-profile/`
- MCP/tooling: `apps/desktop/src/main/ai/mcp/`, `apps/desktop/src/main/ai/tools/`
- Settings propagation: `apps/desktop/src/main/ipc-handlers/settings-handlers.ts`, `apps/desktop/src/shared/types/`, `apps/desktop/src/preload/`, `apps/desktop/src/renderer/`

When touching one side of an Electron contract, check the whole chain:

- main process
- shared types/constants
- preload bridge
- renderer usage
- tests/mocks

## Repo Map

- `apps/desktop/src/main/`: Electron main process, agent runtime, IPC handlers
- `apps/desktop/src/preload/`: Electron bridge APIs
- `apps/desktop/src/renderer/`: React UI
- `apps/desktop/src/shared/`: shared types, i18n, constants, utils
- `apps/desktop/prompts/`: agent prompts
- `shared_docs/ARCHITECTURE.md`: deeper architecture reference

## Stability Notes

- Dev vs packaged path resolution matters in Electron. Check `app.isPackaged`, resource paths, and worktree-relative paths.
- Task and QA loops must stay bounded. If you add retries, add explicit stop conditions and tests.
- Task errors must remain visible in `task_logs.json`, IPC events, and the renderer.
- Worktree and filesystem writes should be atomic or retry-safe when possible.
- If auth/onboarding behavior changes, verify existing profiles, re-auth flows, and terminals with pre-existing credentials.

## Verification

Run the smallest relevant checks first, then broaden only if needed:

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
npx vitest run <targeted-test-files>
```

If you change task execution, auth, IPC, or persistence, add or update targeted tests in the touched area.

