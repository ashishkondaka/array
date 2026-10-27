# OpenBot Bubbles: development

This fork is for personal, noncommercial use (PolyForm Noncommercial 1.0.0, same as upstream).

## Toolchain

| Tool | Version | Install |
| --- | --- | --- |
| Bun | 1.4.2 (README) | `curl -fsSL https://bun.com/install \| bash -s "bun-v1.4.2"` |
| Node.js | 24 (`.nvmrc`) | `nvm install 24 && nvm use` |
| Agent CLI | any one of Codex, Claude Code, Grok, Cursor, OpenCode | log in with the CLI first |

Put both on `PATH` in each shell (the Bun installer edits `~/.zshrc`, a non-login shell may not read it):

```bash
export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
```

## First run

```bash
git clone https://github.com/nightly-labs/openbot.git openbot --origin upstream
cd openbot
git switch bubbles/phase-5-polish   # or the latest bubbles/* branch
bun install --frozen-lockfile
bun run prepare:cua-driver          # Computer Use driver, needed for drag-to-attach
bun run cua-driver:doctor
bun run dev
```

`bun run codex:doctor` checks only Codex. On a computer without Codex it fails with
"ChatGPT is not downloaded"; that is expected. OpenBot finds the Claude, Grok, and Cursor CLIs on
start and logs `A provider changed state ... "to":"available"` for each.

## Daily loop

| Command | What it does |
| --- | --- |
| `bun run dev` | Local Auth API and Electron dev app. Profile `OpenBot Dev wt-<hash>` is tied to this checkout. |
| `bun run dev:status` | Ports and pids of this checkout's stack. |
| `bun run dev:stop` | Stop this checkout's stack. Never use `pkill`. |
| `bun run dev:automation pages` | List the dev app windows (bubbles show as `?window=bubble`). |
| `bun run dev:automation screenshot --page=window=bubble --out=<name>.png` | Screenshot one bubble. Files go under `.openbot-build/dev-automation/`. |
| `bun run dev:cpu --duration=20000 --label=<name>` | Idle CPU sample for all windows. |
| `bun run typecheck:node` / `bun run typecheck:renderer` | One type project at a time (repository rule). |
| `bun run test:desktop -- <file>` | One Vitest file. |
| `bun run verify:preload` | Built preload matches `IPC_ENDPOINTS`. Run after `bun run build`. |

## Gotchas

- `AGENTS.md` asks for narrow checks only. The pre-commit hook runs Biome on staged files,
  `check:ui`, and the `typecheck:*` projects that can see a staged file. Do not bypass it.
- The dev renderer prints `PRIMITIVE_IN_EFFECT_CALLBACK` / `REACTIVITY_HALTED` from
  `agent-event-bridge.tsx` on upstream `main` too. It is not from bubbles.
- The Codex doctor is Codex only. Use `bun run cua-driver:doctor` for Computer Use.
- In dev, macOS grants Screen Recording and Accessibility to the Electron binary
  (`com.github.Electron`), not to "OpenBot Bubbles". A packaged build asks again.
- Updates are off in the fork. `OPENBOT_BUBBLES_ENABLE_UPDATES=1` turns the upstream updater
  back on; do not set it unless you publish your own update feed.

## Packaging (unsigned, local)

See the Phase 5 section of [PROGRESS.md](PROGRESS.md). Short form:

```bash
bun run package          # dist/mac-arm64/OpenBot Bubbles.app, unsigned, not notarized
```
