# OpenBot Bubbles: architecture

Every OpenBot agent of the local host can be pulled out of the main window into an always-on-top
bubble. A bubble is a collapsed orb (avatar plus status ring) or an expanded chat panel for that
agent. Bubbles survive restarts and keep working while the main window is hidden. A bubble dropped on
another app's window attaches the agent to that window: the agent gets the window context each turn
and can act there with Computer Use, through the normal approval flow.

## Fixed decisions

- A bubble is one more renderer window on the same bundle and the same sandboxed preload. No new
  process type, no new privilege.
- A bubble reuses the conversation, attention, Computer Use, and embedded-browser code. There is no
  second chat UI, approval path, provider driver, or browser-extension path.
- New code is namespaced `bubbles`. Edits to upstream files are small hooks marked `bubbles:`
  ([UPSTREAM_TOUCHPOINTS.md](UPSTREAM_TOUCHPOINTS.md)).
- Personal, noncommercial fork. No account service, Team API, or mobile changes.

## Upstream map (as of `f91535fb0`)

### Windows and lifecycle

| What | Where |
| --- | --- |
| Main `BrowserWindow` | `src/main/main-window.ts` `createWindow()`; sandboxed preload `../preload/index.cjs` |
| Renderer URL | `appRendererUrl()` in `main-window.ts`: dev server URL or `openbot-app://app/index.html` |
| Single-chat windows (#2964) | `openChatWindow()` in `main-window.ts`, URL `?window=chat&server=<id>&agent=<id>` |
| Chat-window mode in the renderer | `features/window/chat-window.ts` → `App chatWindow` → `usePlatform().chatWindow`; `WorkspaceShell` hides rail and sidebar and closes the window when the agent is gone |
| Preload pins a chat window's server | `chatWindowServerId` in `src/preload/index.ts` |
| Overlay windows | Dynamic Island (`dynamic-island-window.ts`), Computer Use highlight and permission help (`main-window.ts`) |
| Trusted origin | `src/main/trusted-renderer.ts` checks origin only; any query string passes |
| Lifecycle | `src/main/index.ts`: `window-all-closed`, `before-quit` → `prepareForShutdown()`; `attachQuitOnMainWindowClose` quits on Windows/Linux when the main window closes |
| Tray | `src/main/background-tray.ts`, Windows and Linux only, tied to "keep running in background" |
| Global shortcuts | none upstream |
| Shutdown order | `TEARDOWN_ORDER` in `application-services.ts`, `teardown.push(ordinal, name, run)` |
| Small JSON stores | `PreferenceStore` in `src/main/preference-file.ts`, files `openbot-*-vN.json` in `userData` |

### IPC and preload

| What | Where |
| --- | --- |
| Endpoint list | `packages/contracts/src/ipc-endpoints.ts` `IPC_ENDPOINTS`, `IPC_GROUP_PATHS` |
| Contract types | `packages/contracts/src/ipc-*.ts`, re-exported by `ipc.ts` |
| Handlers | `src/main/ipc/<domain>-handlers.ts`, `define-ipc-group.ts` (`handler`, `payloadHandler`, `eventHandler`, `authorizedHandler`) |
| Registration | `registerIpcGroups({...})` in `src/main/index.ts` |
| Input parsers | `src/main/ipc/*-inputs.ts`, primitives in `validation.ts` |
| Preload | `bridgeGroup(IPC_ENDPOINTS.<group>, decoders)` in `src/preload/index.ts`; decoders in `src/preload/*-decoding.ts` |
| Mock | `src/renderer/src/preview/mock-openbot.ts` |
| Sending to a window | `sendToRenderer(window, IPC_ENDPOINTS.x.y, payload)` in `renderer-ipc.ts` |
| Sender identity | all windows share one origin; per-window checks compare `event.sender.id` (`requireDynamicIslandSender`) |

### Agent status, unread, attention

- `AgentService` emits events; `index.ts` forwards local ones with `forwardAgentEvent("local", e)`
  (`renderer-forwarders.ts`) as `agent:event` to `appWindows()` = main window + chat windows.
  `forwardAgentEvent` stops when the main window is gone.
- Attention lives in `AttentionRegistry` (`src/backend/agent/attention-registry.ts`): approvals
  (`approval`), questions (`prompt`, ui-blocks, MCP elicitation), browser takeover
  (`browser-takeover-requested`, with optional `secret` for secure input). All carry `agentId`.
  `agent-input-resolved` / `browser-takeover-resolved` clear them in every window.
- The renderer has one subscriber, `features/agents/agent-event-bridge.tsx`, writing `turns.tsx`
  (`activeTurns`, `pendingPrompts`, `approvals`). Cards: `ConversationPrompts.tsx`,
  `BrowserSecretCard.tsx`, mounted in `ConversationTimeline.tsx`.
- Answers: `agent.respondToPrompt|Approval|BrowserTakeover|BrowserSecret` → `src/main/ipc/agent-handlers.ts`.
- Unread: `ConversationReadState` from `conversation-page`; `unreadReplies` in `conversation-context.tsx`.
- Sidebar status: `computeSidebarAgentStates` (`features/sidebar/sidebar-agent-states.ts`):
  `waiting | working | responded | unread | routine | limited`.
- Notification clicks: `renderer-forwarders.ts` shows the main window and sends `notifications.opened`.

### Sending and prompts

- Renderer `useConversation().sendMessage` → `agent:send-message` → `AgentService.sendMessage` →
  queue → `drain-scheduler.ts` `inputForThread()` → provider `turn/start`.
- `ConversationRuntime` in the renderer (`features/conversation/conversation-runtime.ts`) is the
  injectable bridge object; in the backend (`src/backend/agent/conversation-runtime.ts`) it is the
  snapshot cache. Neither builds prompts.
- `developerInstructions()` (`src/backend/agent/developer-instructions.ts`) is fixed per session:
  Codex `developerInstructions`, Claude `systemPrompt.append`, ACP/Grok
  `<openbot-developer-instructions>`. Per-turn blocks (`<openbot_section_teammates>`,
  `<openbot_saved_memories>`) are prepended to the turn input and hidden from history by
  `isTurnContextBlock`.

### Computer Use

- `CuaDriverRuntime` (`src/main/cua-driver-runtime.ts`) spawns one `cua-driver serve --socket`
  daemon itself (so macOS attributes grants to OpenBot) and exposes one MCP entry
  `computer_use` (`mcp --socket`) through `AgentService.enabledMcpServers()` → `McpGateway.enabled()`,
  only when the state is `ready` (both macOS grants). Per agent, `StoredAgent.computerUse === false`
  removes it.
- `CuaDriverDaemonClient.listWindows()` (`src/main/cua-driver-daemon-client.ts`) lists windows
  (pid, window id, app, title, bounds, z-order). The driver also has `get_window_state`
  (screenshot + accessibility tree, scoped to one `pid` + `window_id`).
- Permission state and request flow: `computerUse.getState` / `openPermissionPane` IPC,
  `features/computer-use/ComputerUseSetup.tsx`.
- OpenBot draws its own per-display cursor overlay (`computer-use-highlight-window.ts`).

### Embedded browser

- `BrowserHost.open(url, ownerThreadId, ownerAgentId, focus)` (`src/backend/browser-host.ts`),
  IPC `browser.open`. Tabs owned by an agent get the browser tools, secure input and takeover.

## Bubbles design

### Window

`src/main/bubbles/bubble-window-manager.ts` owns one frameless, transparent, always-on-top
(`floating` level) window per agent, visible on all workspaces, skipped by the taskbar. It loads
the normal app URL with `?window=bubble&server=local&agent=<id>`. The renderer treats that exactly
like a chat window (all providers, conversation streaming, attention) plus `platform.bubble`, and
`WorkspaceShell` renders `BubbleShell` instead of the frame.

The prompt asked for a `#/bubble/<agentId>` hash route. The app routes windows by query string
(`?window=chat`), and the preload must pin the server before any code runs, so bubbles use the
query string too.

`main-window.ts` owns every other window upstream. Bubble windows are built in `src/main/bubbles/`
to keep the fork in one directory; they use the same `webPreferences`, `will-navigate` guard and
`setWindowOpenHandler(deny)` as a chat window.

### State

`openbot-bubbles-v1.json` in `userData`: `{ version: 1, bubbles: BubbleState[], hidden }`.
Each entry is re-validated on read; an invalid entry is dropped, not the file. Positions are clamped
to a current display's work area on restore.

### Drag

The orb does not use `-webkit-app-region: drag`, because a drag region swallows the click that
expands it. The orb sends pointer positions (`bubbles.dragTo`) and `bubbles.dragEnd`; main moves the
window and, at the end, resolves the drop target. A pointer that moved less than 4 px is a click.
The expanded panel header uses `-webkit-app-region: drag`; main saves its `moved` position.

### Attention

Bubble windows join `appWindows()` in `renderer-forwarders.ts`, so they receive every `agent:event`
the main window gets, including attention, and answer through the same `agent.respondTo*` IPC.

### Attach

On `dragEnd` main asks `CuaDriverDaemonClient.listWindows()` for the frontmost on-screen window
under the pointer, ignoring OpenBot's own pids. It snaps the orb to that window's top-right corner
and stores `attached` in the bubble state. Main hands the attachment to `AgentService`, and
`drain-scheduler.ts` prepends an `<openbot_attached_window>` block to each turn while attached.
