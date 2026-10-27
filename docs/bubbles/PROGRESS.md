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

## Phase 1: bubble windows (`bubbles/phase-1-windows`)

Works (checked in `bun run dev` with `dev:automation`):

- "Pop out to desktop" in the conversation header and the sidebar agent menu opens a bubble; the
  header and menu then say "Bring back", and the row shows a bubble mark.
- Collapsed orb: avatar, status ring (idle / working / attention / unread, the same derivation as
  the sidebar row), unread count. Click expands to a 380×560 panel; the panel header collapses,
  opens the main window at the agent, or closes the bubble.
- The expanded panel is the normal `WorkspaceConversation` in chat-window mode. A message sent from
  the bubble streamed Claude's reply into the bubble.
- Two bubbles at once (Chief and Research). `openbot-bubbles-v1.json` keeps position, size,
  expanded state; after `bun run dev:stop` and `bun run dev`, the bubble came back expanded where it was.
- Drag: the orb moves its window by pointer (main `setBounds`), a short press is a click. The
  expanded panel header is a drag region; main saves the new position.
- Tray icon (all platforms) while a bubble exists: one entry per bubble, Show/Hide all, Open main
  window, Quit. `Cmd/Ctrl+Shift+Space` toggles all bubbles. Both go away with the last bubble.
- Closing the main window while a bubble exists hides it on every platform, so the agents and the
  event forwarding keep running.
- A close from inside a bubble (Cmd+W, a page reload) collapses it; a crashed bubble reopens once
  per 10 s. A deleted agent's bubble closes (`agents-changed` → reconcile).
- Unit tests: `bubble-state-file.test.ts`, `bubble-layout.test.ts`, `ipc/bubbles-inputs.test.ts`
  (also covers the bubble sender check). `ipc-channel-coverage.test.ts` passes.

Decisions:

- Route: `?window=bubble&server=local&agent=<id>`, not `#/bubble/<id>`; the app routes windows by
  query string and the preload pins the server from it.
- A bubble is a chat window (#2964) that draws the orb or the compact panel, so it reuses every
  provider, the conversation, and the attention cards without a fork of the chat UI.
- Orb drag is pointer-driven, not `-webkit-app-region: drag`: a drag region swallows the click that
  expands the orb. Drag IPC is accepted only from the bubble's own window (sender id).
- The expanded panel is resizable (320–720 × 360–1200) so its saved size means something; the orb is not.
- Bubbles exist for local agents only. On a remote server the pop-out entries are hidden.
- Tests: the prompt asks for unit tests; `AGENTS.md` prefers E2E. The unit tests cover parsing,
  layout and IPC validation (trust boundary), as the prompt asks.
- The shared orb and header live in `@openbot/ui` (`check:ui` keeps Lucide and native controls there).

`bun run build` and `bun run verify:preload` pass (640 methods). `check:ui` passes.

Not yet: hiding the main window is covered by design, not by a run (dev automation cannot close a
window); Windows/Linux not run.

## Phase 2: attention in bubbles (`bubbles/phase-2-attention`)

Works:

- Bubble windows are chat windows, so `forwardAgentEvent` sends them every `agent:event`, as it
  does to the main window. Approvals, questions (`ask_user`, ui-blocks, MCP elicitation), browser
  takeover and secure input render with the same timeline cards and answer with the same
  `agent.respondTo*` IPC. `agent-input-resolved` clears the request in every window.
- The orb ring pulses (warning colour) while the agent waits; a click expands to the chat, where
  the pending card is at the end of the timeline.
- Browser takeover: secure input and Done/Cancel answer in the bubble. The page itself is in the
  embedded browser, which only the main window shows, so the bubble shows a notice with
  "Open browser" (opens the main window at the agent).
- A desktop notification click about a local agent with a bubble shows and expands the bubble
  instead of the main window (`revealBubble`, hook in `renderer-forwarders.ts`).

Decision: bubbles get all agent events, not only their own agent's. The renderer state
(runtime snapshots, sidebar-equivalent status) is per host, as in a chat window; a filter would
need a second event path.

## Design: Liquid Glass (user request)

The user asked for Apple design elements such as Liquid Glass and added
[`emilkowalski/skills`](https://github.com/emilkowalski/skills) (MIT; installed in
`~/.claude/skills/`, not in this repository). The bubble styles follow its `apple-design` skill:

- Material: translucent tint, specular top rim, softer lower rim, depth shadow. A page cannot blur
  the desktop behind a transparent window, and native vibrancy frosts the whole rectangle (a
  square behind a round orb), so the material is CSS; the tint stays mostly opaque for legibility.
- The panel header is real glass (`backdrop-filter`); the chat scrolls under it.
- Status is a glow in the glass edge. Press feedback on pointer-down (scale 0.94).
- Expand "materializes" from the orb corner (blur + scale + opacity together); the orb grows in.
- `prefers-reduced-motion` → short fades, no pulse; `prefers-reduced-transparency` → solid, no
  blur; `prefers-contrast: more` → strong rims. Only palette tokens (`color-mix`), so `check:ui` passes.
