# Installing Array on a Mac

Array is a personal, noncommercial fork of OpenBot (PolyForm Noncommercial 1.0.0). You may use and
share it for noncommercial purposes only.

## What you need

- A Mac with Apple Silicon (M1 or later) and macOS 13 Ventura or later. This build does not run on
  Intel Macs.
- At least one agent CLI, installed and logged in: Codex, Claude Code, Grok, Cursor, or OpenCode.
  Array runs agents through these; it has no model of its own. A local model through Ollama or LM
  Studio also works with OpenCode installed: Array finds it and adds a "Local Analyst" agent. On
  macOS 26 or later with Apple Intelligence turned on, Array also serves Apple's built-in on-device
  model and adds an "Apple Analyst" agent on it (OpenCode installed; nothing leaves the Mac).
- An OpenBot account. Array signs in through OpenBot's account service (`api.openbot.run`), as
  OpenBot does.

## Install

1. Open `Array-<version>-arm64.dmg`.
2. Drag **Array** onto **Applications**.
3. Eject the disk image.

## First open

The app is not signed with an Apple Developer ID or notarized, so macOS blocks the first open.

**macOS 15 Sequoia and later:**

1. Open Array from Applications. macOS says it cannot verify the app. Click **Done** (not **Move
   to Trash**).
2. Open **System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway**
   next to the line about Array.
3. Confirm with **Open Anyway** and your password or Touch ID.

**macOS 13 Ventura and 14 Sonoma:** in Applications, Control-click (or right-click) **Array**,
choose **Open**, then click **Open** in the dialog.

macOS remembers the choice; later opens are normal.

If macOS says the app **is damaged and can't be opened**, the download was quarantined in a way the
steps above do not clear. Run this in Terminal once, then open Array again:

```bash
xattr -dr com.apple.quarantine /Applications/Array.app
```

## Permissions

Array asks for these when a feature needs them, never at install:

| Permission | Used for |
| --- | --- |
| Screen Recording | an agent seeing the window its bubble is attached to |
| Accessibility | an agent clicking and typing in that window |
| Automation | an agent controlling the apps you ask it to |
| Microphone | voice prompts, transcribed on your Mac |

Grant them in **System Settings → Privacy & Security**, then quit and reopen Array. Bubbles,
chats, and everything else work without them; only attaching a bubble to another app's window
(Option-drop) needs Screen Recording and Accessibility.

## Updates

Array does not update itself. To update, download the new DMG and replace the app in Applications.
Your agents, bubbles, and settings stay: they live in `~/Library/Application Support/Array`.

## Uninstall

Quit Array (Cmd+Q, or Quit in the tray menu; closing the window only hides it while bubbles are
out), delete `/Applications/Array.app`, and, to remove your data too,
`~/Library/Application Support/Array`.
