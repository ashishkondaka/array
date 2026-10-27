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
| `scripts/verify-macos-package.ts` | expected bundle id, app path, no icon catalog |
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
