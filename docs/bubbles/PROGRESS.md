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
- Live attach test (dev run from Terminal, which holds the grants): Option-drop on TextEdit showed
  "Release to attach to TextEdit", attached, snapped to the window corner; the agent described the
  window and typed into it. The browser handoff was not run: Safari stayed behind another window.
- A live agent: while an attached agent acts, the orb follows its Computer Use action point (120 ms
  tick on the driver tap, 16 pt dead zone) and goes back to the corner 2.5 s after the last action;
  the orb's chip shows the current step. The attached-window block tells the agent to work in the
  background (element tokens, background typing, no `bring_to_front`) and to read the window fresh
  before each action. When one agent messages another, the caller's orb flies to the callee's.
- Liquid open and close: the window's corner stays at the orb's corner and the frame springs
  (response 0.32 s) between orb and panel size, while the panel's `clip-path` grows from the orb's
  circle. The panel is prepared while the orb idles and then only shown and hidden, at its saved
  size: before, a close unmounted and remounted the conversation (a 1 s stall), and an open laid the
  whole conversation out at the click and reflowed it on every frame of the growing window. Frame
  trace of an open and close: longest frame 1 s → 28–34 ms (two at the start of the open, native
  resize and first glass paint, dev build), JS at the click 90 ms → 2 ms. Idle CPU unchanged.
- A collapsed bubble no longer marks replies read: read state is per window, and a focused orb
  counted as an open chat. Opening the bubble marks them read.

Rebase: `git fetch upstream` found no new commits on `upstream/main` (still `f91535fb0`), so the
branches need no rebase today. To rebase later: `git fetch upstream && git rebase upstream/main` on
the newest `bubbles/*` branch, fix conflicts by keeping upstream's change and putting each
`bubbles:` hook back ([UPSTREAM_TOUCHPOINTS.md](UPSTREAM_TOUCHPOINTS.md)).

Package: `bun run package` built `dist/mac-arm64/Array.app` (950 MB, arm64, unsigned, not notarized,
updater off). `bun run verify:package` passes after pointing it at the fork's executable name and icon:
bundle id `app.array.desktop`, runtimes, ASAR integrity, hardened fuses, and a launch plus
second-instance check of the packaged app.

Distribution (user request: a Mac app anyone can download): `bun run dist:mac` made
`Array-0.51.1-arm64.dmg` (322 MB) and a zip. Unsigned (ad hoc), not notarized, Apple Silicon,
macOS 13 or later. Checked: `verify:package` passes with a launch; a quarantined copy of the DMG
verifies, mounts, and holds the same app (same code hash); its signature is valid (deep, strict),
so macOS offers "Open Anyway" and does not call it damaged; Gatekeeper rejects it until then, as
expected without notarization. The permission prompts now say Array. Not done: opening the
downloaded copy through "Open Anyway" by hand (it needs a person at the dialog). Install steps:
[INSTALL.md](INSTALL.md).

Liquid Glass rework (user report: the UI looked broken). The first glass layer tinted the whole
window, and the sidebar's tint sat on the card's tint, so the window read as one washed-out grey
sheet. Now the chat card is solid and starts at the sidebar's edge, the sidebar floats as an inset
glass pane over the native blur, and the chrome tint is 28 %. Checked in dark mode on the dev app
through the Computer Use daemon's screen capture: solid chat, sidebar pane with rim and shadow,
capsule composer; sidebar resizing leaves no stale pixels. A CSS hot reload left ghosted text in the
sidebar until the page reloaded (dev only). Not checked: light mode, an inactive window, and whether
the top row leaves a faint trail while the sidebar animates (one capture showed one; the display
slept before a second capture).

The DMG was rebuilt with the glass rework: `verify:package` passes (launch included), the ad-hoc
signature verifies deep and strict, and the packaged stylesheet holds the new `--array-glass-*`
rules with the reduced-transparency fallback. Still not done by hand: the first "Open Anyway".

Opaque window (user report: ghost text and flicker, apps showing through; user chose the opaque
window over a native Liquid Glass addon). Diagnosis: the renderer's own frame (CDP
`Page.captureScreenshot`) had no ghost, so the doubled header text was stale paint left by the
window compositor in the translucent parts of the transparent window; the apps showing through were
macOS 27 stopping the blur while the window was inactive (Electron's default `visualEffectState`,
`followWindow`) under tints of 28 % and 52 %. Electron 44 has no Liquid Glass API (`electron.d.ts`
has no glass; only `vibrancy`), and a native `NSGlassEffectView` addon would keep the transparent
window, so it would keep the ghosting, and could only glass the chrome against the desktop, never a
toolbar over the chat. Now `DEFAULT_TRANSPARENT_WINDOW` is off, `array-glass.css` draws the pane,
the card and the glass composer, menus and dialogs on the opaque window, and the transparent window
is an opt-in with 72 % / 84 % tints and `visualEffectState: "active"`. A dev-profile preference saved
while the default was on still said `true`; it was set to `false` by hand. Note for dev: a main-process
edit restarts Electron, and `dev-services` then stops the whole stack ("stopped with code 0"), so
`bun run dev` has to be started again.

Checked on the dev app after the restart (renderer frames over CDP, light and dark emulated): the
sidebar pane has its 20 px radius and 6 px inset, the chat card is solid, the composer blurs the
message under it, and the top row has no ghost. The Settings toggle turns the glass on (transparent
body, 72 % frame tint) and off again, and the saved preference ends at `false`. The DMG was rebuilt
from the committed tree: `verify:package` passes with a launch, the ad-hoc signature verifies deep
and strict, and the packaged main bundle and stylesheet hold `visualEffectState: "active"`, the
palette rim token and the 72 % opt-in tint. Not checked: the on-screen window itself (the display
was asleep, so the Computer Use capture had nothing to show), and the first "Open Anyway" by hand.

In-app name (user report: the first-run screen of the packaged app said OpenBot). The bundle, Dock,
menus and prompts said Array; the UI did not: upstream's catalogs name the product in 861 English
messages (9,770 across the locales) and six components held the literal. Rewriting the catalogs
would make every upstream merge a conflict, so the i18n package swaps the name at render time
(`setProductName`, `brandText` in `createTranslate`, applied to the message before interpolation so
data such as "OpenBot Local Dev Host" is not renamed), and the literals read `productName()`. The
sign-in e-mail ("Your OpenBot sign-in code") and the account pages come from OpenBot's account
service at `openbot.run`; the app cannot rename them, and the account service is out of scope.
Checked on the dev app: the window title is "Array", the search field says "Search Array", and
main's provider messages say "Download it in Array"; what still says OpenBot is data (the dev host
"OpenBot Local Dev Host", seeded channel text). The DMG was rebuilt from the committed tree:
`verify:package` and the deep, strict signature check pass, and the packaged `index.html` title is
Array. The main bundle still holds 71 "OpenBot" literals: the catalog messages, swapped at render.

Next (user request): a free bubble asked about something an open app shows ("can you read my
emails" with Mail open) answered with the embedded browser and a sign-in. Only an attached bubble is
briefed about a window (`attached-window-context.ts`: pid, window_id, "treat it as the subject");
a free bubble has the Computer Use tools (every agent, `computerUse !== false`, once the driver's MCP
server runs) but nothing tells it the desktop exists, so it reaches for the browser. The feature
is a short desktop block for free bubbles (the windows on screen, from the daemon's desktop state)
with guidance to look at the matching window and attach itself there, so the orb moves to it.

Built (user request: "let it be a worker, and the desktop is its office"): `go_to_app`, a direct
OpenBot tool, and the `<openbot_desktop>` block for free bubbles. The block is static (no window
list per turn: the agent asks `list_apps`/`list_windows` itself when it needs to, and the result of
`go_to_app` names the window), so a free bubble costs nothing per turn and no window titles leak
into every turn. `goToApp` reads windows and apps only; opening an app stays with the agent's
`launch_app`, under its approval policy. The orb's trip: the panel closes if open, the orb flies by
the Dock (the middle of the Dock strip; the driver has no icon positions), pauses 360 ms, flies onto
the window's corner and attaches. Unit tests: `go-to-app.test.ts` (app matching, window choice,
`list_apps` parsing, Dock stop on three edges and hidden). Narrow checks: `typecheck:node`, Biome.

Live, on the dev app with Chief (claude-haiku-5-5), messages sent over CDP into the bubble's
composer, the orb's position read from its page every few seconds:
- "go to the Terminal app and tell me the title of its front window": the open panel (388 × 572)
  closed, the orb flew to the Terminal window's corner (725, 402) and attached (the 280 px attached
  orb), and Chief answered with the window's title from `get_window_state`. 2 steps, 11 s.
- "read my mail" (Mail on another Space, full screen): the first run, before the text fix, had
  Chief ask the user to open the inbox. After the fix it tried `bring_to_front` and `launch_app`
  itself (12 steps, 1 failed) and still found no Mail window on this screen. The screen was locked
  during the test (`CGSSessionScreenIsLocked`), and macOS does not bring another Space's window
  forward while locked; the Terminal window was already on the current Space. Not verified: the
  Mail journey on an unlocked Mac, and whether the full-screen Space switch lands the orb on it
  (the bubble windows are visible on all Spaces and in full screen, so it should).
- A main-process or backend edit, and Biome reformatting one, restarts Electron and `dev-services`
  then stops the stack; each test run here needed `bun run dev` started again from Terminal.

The DMG was rebuilt from the committed tree with the feature: `verify:package` and the deep, strict
signature check pass, and the main bundle holds `go_to_app` and the `<openbot_desktop>` block.

Local Analyst (user report: every turn failed at once with `"llama3.2:latest" does not support
thinking`). Found: Ollama refuses a request with `think: true` for a model without the "thinking"
capability (`/api/show` lists `completion, tools` only); OpenCode sends `think` whenever a thinking
level (its "variant") is applied, and declaring `reasoning: false` in its config does not stop it
(checked with `opencode run -m local-ollama/llama3.2:latest#low`, which fails the same way, while a
run without a variant answers). OpenBot applies the agent's reasoning effort (`low` by default; the
contract has no "off") through `applyConfig`, so every Local Analyst turn carried a variant. Fix:
`src/main/bubbles/thinking-capabilities.ts` asks each custom endpoint whose origin answers Ollama's
`/api/tags` about its models with `/api/show`, and `src/backend/bubbles/model-thinking.ts` keeps the
`provider/model` ids that cannot think; `applyConfig` skips the thinking level for them. Read before
the first turn and on each catalogue change; an endpoint that is not Ollama says nothing and keeps
OpenBot's behaviour. Unit tests: `thinking-capabilities.test.ts`. Seen in the dev log:
`Read the thinking capability of the local models {"models":1,"withoutThinking":1}`.

## Status against the definition of done

| Item | State |
| --- | --- |
| Clean clone + documented commands run the app with bubbles | Done ([DEV.md](DEV.md)) |
| Two agents in bubbles, main window closed; messages, streaming, questions from the bubble; state survives restart | Done; closing the main window is by design (it hides), not run by hand. Approval cards share the question path, not run live |
| Drop on window → context + Computer Use action with approval; browser handoff | Built and unit-tested (Option-drop). Not run live: the dev Electron binary has no Screen Recording / Accessibility grant on this computer |
| `bun run check` passes | Not run: `AGENTS.md` asks not to run it locally. Run instead: `typecheck:node`, `typecheck:renderer`, `typecheck:storybook`, `check:ui`, `build`, `verify:preload`, `verify:package`, the pre-commit hook on every commit, and the bubble test files (53 tests) plus `ipc-channel-coverage.test.ts` |
| Unit tests: state file, IPC validation, attach/detach transitions | Done (`bubble-state-file`, `bubbles-inputs`, `attach-target`, plus `bubble-layout`, `bubble-motion`, `local-analyst`) |
| `docs/bubbles/` complete | Done: ARCHITECTURE, DEV, PROGRESS, UPSTREAM_TOUCHPOINTS, FINETUNE |
| GIF of attach in `docs/bubbles/` | Not made: needs the Computer Use grants and a screen recording on this computer |
