# Array (OpenBot Bubbles fork): development

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
git switch bubbles/phase-5-polish   # the latest bubbles/* branch; each phase branch builds on the last
bun install --frozen-lockfile       # postinstall also names the dev Electron app "Array"
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
- Solid 2 RC halts a whole window (`REACTIVITY_HALTED`) when a reactive primitive is created inside
  an effect callback. Two causes were fixed here: upstream's provider update toast (now shown from a
  microtask) and ternary JSX props on the avatar. Pass a helper function (`hue={avatarHue()}`), never
  `hue={a ? b : c}`, to a component that reads the prop in an effect. Check the dev log for the halt
  after UI changes: `grep REACTIVITY_HALTED`.
- Tailwind's preflight sets `[hidden] { display: none !important }`. To keep an element laid out while
  hidden, use a data attribute with `visibility: hidden` and `inert`, as the bubble panel does.
- The Codex doctor is Codex only. Use `bun run cua-driver:doctor` for Computer Use.
- In dev, macOS grants Screen Recording and Accessibility to the Electron binary
  (`com.github.Electron`), shown as "Array" after `scripts/bubbles-dev-name.ts`. A packaged build
  (`app.array.desktop`) asks again.
- `scripts/bubbles-dev-name.ts` re-signs the dev `Electron.app` ad hoc after renaming it. If macOS
  refuses to open it, run `bun install --frozen-lockfile` again (it restores the original from the
  shared cache, then renames it).
- Bubble interactions: click the orb to open, click the agent in the panel header to close, drag to
  place anywhere, hold Option (Alt) while dropping on a window to attach. Tray: "Lively bubbles
  (nudges and visits)", Show/Hide all (`Cmd/Ctrl+Shift+Space`).
- `bun scripts/export-conversations.ts --list` / `--agent=<id>`: see [FINETUNE.md](FINETUNE.md).
- Updates are off in the fork. `OPENBOT_BUBBLES_ENABLE_UPDATES=1` turns the upstream updater
  back on; do not set it unless you publish your own update feed.

## Packaging (unsigned, local)

```bash
bun run package          # dist/mac-arm64/Array.app: unsigned, not notarized, no updater
bun run verify:package   # checks the bundle id, the runtimes and the preload
```

`package` downloads the voice and remote-desktop runtimes and the pinned Computer Use driver first.
The app is ad hoc signed, so the first open needs right-click → Open (or
`xattr -dr com.apple.quarantine dist/mac-arm64/Array.app` for a copy that was downloaded).
`bun run dist:mac` makes a DMG the same way.
