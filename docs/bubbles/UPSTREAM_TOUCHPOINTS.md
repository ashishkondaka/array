# Upstream touchpoints

Every edit to an upstream file is a small hook marked `// bubbles:` (or `# bubbles:` in YAML).
New code lives in `src/main/bubbles/`, `src/renderer/src/features/bubbles/`,
`packages/contracts/src/ipc-bubbles.ts`, `src/preload/bubbles-decoding.ts`, and `docs/bubbles/`.
On a rebase conflict, keep upstream's change and put the hook back.

Find them all:

```bash
git grep -n "bubbles:" -- ':!docs/bubbles' ':!src/main/bubbles' ':!src/renderer/src/features/bubbles'
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
