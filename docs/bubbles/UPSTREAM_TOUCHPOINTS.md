# Upstream touchpoints

Every edit to an upstream file is a small hook marked `// bubbles:` (or `# bubbles:` in YAML).
New code lives in `src/main/bubbles/`, `src/renderer/src/features/bubbles/`,
`packages/contracts/src/ipc-bubbles.ts`, `src/preload/bubbles-decoding.ts`, and `docs/bubbles/`.
On a rebase conflict, keep upstream's change and put the hook back.

Find them all:

```bash
git grep -nE "(//|#|/\*\*?|\{/\*) bubbles:" -- ':!docs/bubbles'
```

## Phase 0: identity and updates

| File | Hook |
| --- | --- |
| `package.json` | `productName: "OpenBot Bubbles"` |
| `electron-builder.yml` | `appId: app.openbot.bubbles`, `productName`, placeholder icons, no `CFBundleIconName` |
| `src/main/index.ts` | packaged `userData` = `OpenBot Bubbles`; `app.setName`; Windows app user model id; packaged icon variant `preview` |
| `src/main/application-services.ts` | `PACKAGED_BUNDLE_IDENTIFIER`, ShipIt cache name, `bubblesUpdatesAllowed()` in the updater gate |
| `scripts/verify-macos-package.ts` | Array: bundle id, app path, executable and display name, placeholder icon, no icon catalog |
| `build/bubbles/icon.icns` | new file, made from `build/icon-preview.png` |

## Phase 1: bubble windows

New files: `packages/contracts/src/ipc-bubbles.ts`, `packages/i18n/src/messages/en/bubbles.ts`,
`packages/ui/src/features/bubbles/*`, `src/main/bubbles/*`, `src/main/ipc/bubbles-*.ts`,
`src/preload/bubbles-decoding.ts`, `src/renderer/src/features/bubbles/*`,
`src/renderer/stories/BubbleOrb.stories.tsx`.

| File | Hook |
| --- | --- |
| `packages/contracts/src/ipc.ts` | re-export `ipc-bubbles` |
| `packages/contracts/src/ipc-endpoints.ts` | `bubbles` group and its `IPC_GROUP_PATHS` entry |
| `packages/i18n/src/messages/en/index.ts` | spread the `bubbles` catalog |
| `packages/ui/package.json` | four `./features/bubbles/*` exports |
| `packages/ui/src/features/sidebar/sidebar-types.ts` | `onPopOutAgent`, `onBringBackAgent`, `poppedOutAgentIds` props |
| `packages/ui/src/features/sidebar/SidebarAgentContextMenu.tsx` | "Pop out to desktop" / "Bring back" item |
| `packages/ui/src/features/sidebar/SidebarAgentRow.tsx` | bubble mark on a popped-out row |
| `packages/ui/src/features/conversation/ConversationHeader.tsx` | optional `popOut` button |
| `src/main/index.ts` | construct `BubbleWindowManager`; register IPC; hide (not close) the main window while bubbles exist; restore after agent init; reconcile on `agents-changed`; tray icon, labels, teardown |
| `src/main/main-window.ts` | `getChatWindows()` includes bubble windows (agent events, auth, language, focus) |
| `src/preload/index.ts` | pin the server for `?window=bubble`; `bridgeGroup(IPC_ENDPOINTS.bubbles, …)` |
| `src/renderer/src/index.tsx`, `App.tsx`, `app-providers.tsx`, `platform.tsx` | pass `bubble` to `usePlatform()`; mount `BubblesProvider` in the server scope |
| `src/renderer/src/WorkspaceShell.tsx` | a bubble window renders `BubbleShell` |
| `src/renderer/src/AppView.tsx` | no startup splash in a bubble |
| `src/renderer/src/features/sidebar/WorkspaceSidebar.tsx` | wire the sidebar props |
| `src/renderer/src/features/conversation/ConversationHeader.tsx` | wire the header button |
| `src/renderer/src/features/provider-updates/provider-runtime-store.ts` | show the update toast from a microtask: upstream created a root inside an effect callback, which halts every update of a window under Solid 2 RC (it froze bubbles and also hit the main window) |
| `src/renderer/src/preview/mock-openbot.ts` | `bubbles` mock |
| `src/renderer/src/styles.css` | import `bubbles.css` |

## Phase 2: attention

| File | Hook |
| --- | --- |
| `src/main/renderer-forwarders.ts` | a notification click about a local agent with a bubble reveals the bubble |
| `packages/ui/package.json` | `./features/bubbles/BubbleNotice` export |

## Phase 3: attach, characters, motion, chats

New files: `src/main/bubbles/attach-target.ts`, `bubble-attach.ts`, `bubble-attach-wiring.ts`,
`bubble-motion.ts`, `src/backend/bubbles/attached-window-context.ts`,
`packages/ui/src/features/bubbles/bubble-characters.ts`, `BubbleNotice.tsx`,
`packages/ui/src/features/sidebar/SidebarBubbleCharacterSubmenu.tsx`,
`src/renderer/src/features/chats/new-chat.ts`.

| File | Hook |
| --- | --- |
| `src/backend/agent/drain-scheduler.ts` | `inputForThread` = `withAttachedWindow(agent.id, …)` |
| `src/backend/agent/developer-instructions.ts` | `isTurnContextBlock` knows `<openbot_attached_window>` |
| `src/main/cua-driver-daemon-client.ts` | read-only `windowState(pid, windowId, query)` |
| `src/main/index.ts` | build `BubbleAttachController` with the services; teardown |
| `packages/ui/src/features/agents/AgentAvatar.tsx` | optional `fps` prop (a moving orb draws at 120 fps) |
| `packages/ui/src/features/sidebar/SidebarAgentContextMenu.tsx` | "Bubble character" submenu |
| `packages/ui/src/features/sidebar/SidebarTopbar.tsx` | "New chat" item |
| `packages/ui/src/features/sidebar/sidebar-types.ts` | `bubbleCharacterOf`, `onChooseBubbleCharacter`, `onCreateChat` |
| `src/renderer/src/features/sidebar/WorkspaceSidebar.tsx` | wire characters and New chat |

## Phase 4 and Array

New files: `src/main/bubbles/local-analyst.ts`, `scripts/export-conversations.ts`,
`scripts/bubbles-dev-name.ts`, `src/renderer/src/styles/array-glass.css`, `docs/bubbles/FINETUNE.md`.

| File | Hook |
| --- | --- |
| `src/main/index.ts` | start the local analyst seed after agent init; retry on `status` events |
| `package.json` | `productName: "Array"`; `postinstall` ends with `bubbles-dev-name.ts` |
| `electron-builder.yml` | `appId: app.array.desktop`, `productName: Array` |
| `packages/contracts/src/app-appearance.ts` | `DEFAULT_TRANSPARENT_WINDOW` (on at first; off since the opaque-window rework, see Phase 5) |
| `packages/i18n/src/messages/en/window.ts` | native window titles say Array |
| `src/renderer/src/styles.css` | import `array-glass.css` after `window-glass.css` |

## Phase 5: polish

| File | Hook |
| --- | --- |
| `src/renderer/src/features/window/window-page-context.tsx` | `conversationCovered` is also true while a bubble is an orb, so a reply nobody saw stays unread |
| `electron-builder.yml` | the macOS permission prompts (microphone, screen, Automation) say Array |
| `scripts/verify-macos-package.ts` | expects the Array microphone prompt |
| `packages/contracts/src/app-appearance.ts` | `DEFAULT_TRANSPARENT_WINDOW = false`: the window is opaque, the page draws the glass |
| `src/main/main-window.ts` | the two chat windows pass `visualEffectState: "active"`, so the opt-in glass window keeps its blur while inactive |
| `src/main/window-appearance.ts` | comment only: why the blur stays live |
| `packages/contracts/package.json`, `packages/contracts/src/fork-identity.ts` | `BUBBLES_PRODUCT_NAME`, the name every process shows (new file, one export entry) |
| `packages/i18n/src/product-name.ts`, `packages/i18n/src/message.ts`, `packages/i18n/src/index.ts` | `createTranslate` swaps "OpenBot" for the product name an app set with `setProductName`; the catalogs are untouched, and an app that sets none (mobile) reads them as written |
| `src/main/index.ts` | `setProductName(BUBBLES_APP_NAME)` next to `app.setName` |
| `src/renderer/src/index.tsx`, `src/renderer/src/helper.tsx` | `setProductName(BUBBLES_PRODUCT_NAME)` before the first render |
| `packages/ui/src/features/account/LanguageWheel.tsx`, `AccountLogin.tsx`, `src/renderer/src/features/onboarding/SetupReadError.tsx` | the wordmark reads `productName()` instead of a literal |
| `src/renderer/src/platform.tsx`, `features/computer-use/ComputerUsePermissionHelp.tsx`, `features/agent-templates/agent-template-card.tsx` | the app-info fallback, the permission card and the template card read `productName()` |
| `src/renderer/index.html`, `helper.html`, `browser-pip.html`, `team-webrtc.html` | the static `<title>` (the window title before a page sets its own, and the accessibility name of the window) says Array |
| `src/backend/openbot-tools.ts` | spreads `DESKTOP_WORKER_TOOL_DEFINITIONS` (`go_to_app`) into the OpenBot tools |
| `src/backend/agent/tool-catalog.ts` | `go_to_app` is a direct tool (visible without `tool_search`) |
| `src/backend/agent/openbot-tool-router.ts` | dispatches `go_to_app` to `desktop-worker.ts`, after the Computer Use check |
| `src/backend/agent/developer-instructions.ts` | `isTurnContextBlock` knows the `<openbot_desktop>` block |
| `src/main/cua-driver-daemon-client.ts` | `listApps()` (the driver's `list_apps`), beside `windowState()` |
| `README.md` | Array's own README; upstream's moved unchanged to `docs/OPENBOT_README.md` |
| `src/backend/acp-configuration.ts` | `applyConfig` sends no thinking level to a model in `model-thinking.ts`'s registry (Ollama says it cannot think) |
| `src/main/index.ts` | `createThinkingCapabilities`: refreshed before the first turn and on each model catalogue change; `createAppleModelServer`: started after it, stopped in teardown, `tryCreate` on each catalogue change |
| `package.json`, `electron-builder.yml`, `.gitignore` | `prepare:apple-model-server` in `dist:mac`; `build/apple-model-server/darwin/${arch}` shipped as a resource; the build output ignored |
