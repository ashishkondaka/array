# OpenBot Bubbles: progress

## Phase 0: setup and dev loop (`bubbles/phase-0-setup`)

Works:

- Clone with the `upstream` remote at `f91535fb0`. Bun 1.4.2, Node 24.22.1, `bun install --frozen-lockfile`.
- `bun run dev` starts. Claude, Grok and Cursor CLIs are detected. The seeded profile shows.
- `bun run prepare:cua-driver` installs cua-driver 0.34.0; `bun run cua-driver:doctor` is ok.
- Fork identity: product name `OpenBot Bubbles`, app id `app.openbot.bubbles`, packaged `userData`
  `~/Library/Application Support/OpenBot Bubbles`, placeholder icon (the upstream preview icon).
- Self-updater off unless `OPENBOT_BUBBLES_ENABLE_UPDATES=1`.

Decisions:

- Dev profiles keep the upstream names (`OpenBot Dev wt-<hash>`). The hash is of this checkout's
  path, so the profile is already separate from any other OpenBot checkout and from the installed app.
- The `openbot://` deep-link scheme stays. Registration runs only in a packaged build on macOS and
  Windows; when both apps are installed, the last one started owns the scheme. Bubbles do not use it.
- `codex:doctor` fails on this computer (no Codex). Claude is the provider used for checks.
- Checks follow the repository rule (one type project at a time, pre-commit hook), not
  `bun run typecheck` / `bun run check`, which `AGENTS.md` asks not to run locally. The build
  prompt's `bun run typecheck` is covered by `typecheck:node` + `typecheck:renderer`.
