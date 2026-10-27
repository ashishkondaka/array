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

Checked live: Research (in a bubble) asked an `ask_user` question ("Red or Blue"). The main
window's sidebar showed "Waiting for your answer"; the bubble showed the question card. Choosing
Blue in the bubble sent the answer, the agent replied "Blue", and the main window's wait cleared.
Not run live: an approval card (the seeded agents run with full access, so no approval comes up).
It uses the same timeline and the same `agent.respondToApproval` path as the question.

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

## Phase 3: drag-to-attach, plus characters, motion and chats (`bubbles/phase-3-attach`)

User requests folded into this phase: characters picked in the main app, an orb that moves on its
own and nudges, 120 Hz motion, free-form dragging, and plain chats beside agents.

Works (unit-tested, type-checked; live where noted):

- Orb centred in its window, avatar sized to the orb (checked by screenshot).
- Characters: eight original characters (Pip, Pebble, Nimbus, Hexa, Bean, Spark, Cubby, Rosie), each
  a body shape and colour of the avatar engine with the agent's own face. Picked per agent from the
  sidebar menu "Bubble character"; kept in `openbot-bubbles-v1.json` (`characters`), so a choice
  survives "Bring back". Older files load with no characters.
- Motion: the avatar animates only while working, waiting or moving (otherwise it rests, which keeps
  idle CPU down). A resting orb hops every 25–55 s (squash and stretch). On a new reply or a question
  the orb springs to the pointer, wiggles, and springs home after 3.5 s; once a minute at most, not
  when expanded, attached or hidden; off under reduced motion; tray toggle "Let bubbles nudge me".
- 120 Hz: main moves the orb once per display frame (`displayFrequency`, 8.3 ms on ProMotion) on a
  critically damped spring advanced by real elapsed time. Renderer motion animates only `transform`
  and `opacity` (compositor, display rate). A moving orb's avatar draws at 120 fps, a resting one at
  the shared 30 fps cap. Drag moves coalesce per animation frame.
- Free-form drag: a drop is a placement anywhere, with no snapping. The orb lifts while carried. A
  fast release is a throw: Apple's momentum projection (deceleration 0.995) picks the landing point,
  kept on the display, and the spring starts at the release velocity.
- Attach is deliberate: rest the orb over another app's window for 0.6 s mid-drag; it arms (accent
  glow, tooltip "Release to attach to <App>"); releasing then attaches and snaps to the window's
  top-right corner. Moving on disarms. Dragging an attached orb away and releasing detaches it.
  While attached the orb follows its window (2 s poll, only while something is attached) and
  detaches when the window closes. Detach button in the panel header.
- Each turn of an attached agent starts with an `<openbot_attached_window>` block (app, title,
  pid, window_id, bounds, "call get_window_state first, act only in this window"); Claude's history
  view hides it like the memory block. Provider-agnostic, in `drain-scheduler.ts`.
- Browser windows (Chrome, Edge, Brave, Arc, Safari, Firefox): the address bar is read from the
  accessibility tree; the bubble offers "Open in OpenBot browser", which opens the page in the
  embedded browser as the agent's tab.
- Without Computer Use grants, resting over a window records an issue; the bubble shows the fix
  ("Open Settings" opens the macOS pane) when you open it. A drag never opens the panel.
- Plain chats: "New chat" in the sidebar "+" menu creates an agent with the "Chat" role badge,
  workspace-only access, no Computer Use, and instructions to answer directly. It uses any model the
  header picker offers (local Ollama / LM Studio models through the custom-endpoint path) and can
  pop out as a bubble. Decision (user): chats are tool-less agents, no database migration.

Not verified live yet: attaching to a real window (needs Screen Recording and Accessibility for the
dev Electron binary), the throw and dwell by hand, nudges on a real reply.
Known limits: a provider CLI keeps its own built-in tools; a chat is told not to use them, and its
file access is limited to its own folder. Computer Use is not turned on for a turn if the agent has
it off; the bubble does not override the agent's setting.

### Phase 3 follow-up (user feedback on the drag)

- A released orb stays exactly where it was let go: no momentum, no snapping.
- Attaching needs Option (Alt) held at release (the orb's tooltip says so). With it held, a short
  rest over a window shows "Release to attach to <App>".
- A nudge flies the orb over the top centre of the front app window (from the Computer Use window
  list; the top centre of the display without it), hovers there with a slow bob, and flies home.

## Phase 4: local model persona and export (`bubbles/phase-4-local`)

- Local Analyst seed (`src/main/bubbles/local-analyst.ts`): on a start that finds Ollama
  (127.0.0.1:11434) or LM Studio (127.0.0.1:1234), the server is saved as a custom endpoint
  ("Ollama (this computer)", id `local-ollama`, the server's models). Checked live: it found
  `llama3.2:latest` and saved the endpoint. The agent "Local Analyst" is created once
  `local-ollama/<model>` is in the model catalogue, which needs OpenCode (OpenBot downloads it on
  request; not downloaded on this computer, so the agent is not created yet). It retries on every
  catalogue change and on each start, and runs once.
- `scripts/export-conversations.ts`: read-only (`node:sqlite` `readOnly`), redacted with
  `redactText`, JSONL `{"messages":[{role,content}]}` windows under `.openbot-build/exports/`.
  Checked live on Research (one conversation from three threads). See [FINETUNE.md](FINETUNE.md).

## Array: name and glass (user requests)

- The app is named **Array**: product name, app id `app.array.desktop`, packaged `userData` `Array`,
  window titles, tray, welcome notification. `scripts/bubbles-dev-name.ts` (end of `postinstall`)
  renames this checkout's dev `Electron.app` to Array and signs it again ad hoc, so the menu bar and
  Dock say Array in `bun run dev` too. In-app text that names OpenBot (server names, help, links) is
  unchanged.
- Glass UI: the transparent window (macOS blur) is on by default (`DEFAULT_TRANSPARENT_WINDOW`); a
  saved choice in Settings still wins. `src/renderer/src/styles/array-glass.css` makes it frosted and
  mostly opaque, and gives the sidebar, composer, menus and dialogs the bubbles' glass material.
  Reduced transparency turns it solid.

## Phase 5: polish (`bubbles/phase-5-polish`)

Edge cases:

- Display removed or changed (`display-removed`, `display-metrics-changed`): every orb is clamped
  onto a display that remains, the primary one when its own is gone.
- Agent deleted while popped out: its bubble closes and its state is dropped (`agents-changed`).
- Two bubbles snapped to one window: the second is offset downwards (`separateOrb`).
- Reduced motion: no hops, nudge flights, wiggles or pulses; a still halo shows attention.
- A bubble closed from inside (Cmd+W, a reload) collapses; a crashed one reopens once per 10 s.

Idle cost (`bun run dev:cpu --duration=20000`, files in `.openbot-build/dev-automation/cpu/`):

| Run | Total CPU | Bubble renderers |
| --- | --- | --- |
| No bubbles | 1.3 % | n/a |
| Three collapsed bubbles, first build | 18.1–23.9 % | up to 52 ms/s task, 25 style recalcs/s |
| Three collapsed bubbles, fixed | 0.8 % | 0 ms/s each |

The cost was the avatar: an agent with a recent reply has a "responded" mood that animates the
avatar engine at 30 fps on every orb, and the attention pulse animated `box-shadow` (a paint per
frame). A resting orb now shows a still avatar (the ring carries the status), and the pulse is a halo
that animates `transform` and `opacity` only.

User requests in Phase 5:

- Click to close in place: the panel opens offset from the orb (`PANEL_OFFSET`) so its header avatar
  button sits where the orb's centre was; clicking the agent again closes it. Checked with dev
  automation (the header avatar is the first "Collapse" button; clicking it collapses).
- Bubbles mingle: each bubble asks to visit every 20–45 s divided by the number of other bubbles, so
  a crowd mingles more. Main floats it (spring response 1.1 s) beside one or two other orbs, both play
  a greet (hop and tilt), the visited orb is bumped 18 pt away and springs back, and the visitor
  floats home. Only collapsed, unattached, idle bubbles take part; the tray toggle "Lively bubbles
  (nudges and visits)" and reduced motion turn it off. Over a minute with three bubbles mingling,
  total CPU averaged 8.1 % (main 4.1 %, moving windows during visits); between visits it is near 0.
- Fixed a window freeze: ternary props on the avatar (`mood={a ? b : c}`) compile to memo-creating
  getters that the avatar reads in an effect, which halts the window under Solid 2 RC (the orbs
  stopped expanding). They are plain helper functions now; 90 s of visits ran with no halt.

Rebase: `git fetch upstream` found no new commits on `upstream/main` (still `f91535fb0`), so the
branches need no rebase today. To rebase later: `git fetch upstream && git rebase upstream/main` on
the newest `bubbles/*` branch, fix conflicts by keeping upstream's change and putting each
`bubbles:` hook back ([UPSTREAM_TOUCHPOINTS.md](UPSTREAM_TOUCHPOINTS.md)).
