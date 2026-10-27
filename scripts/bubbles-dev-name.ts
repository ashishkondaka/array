#!/usr/bin/env bun
// Makes the development Electron app "Array" (OpenBot Bubbles fork), so the Dock, the menu bar, the
// app switcher, Finder and the Privacy & Security lists say Array instead of Electron during
// `bun run dev`. A packaged build takes its name from `electron-builder.yml`; only the dev binary
// needs this.
//
// It edits this checkout's `node_modules/electron/dist` only: the bundle's display names, its folder
// (`Electron.app` → `Array.app`, what Finder and System Settings show) and `path.txt`, which the
// `electron` package reads. The executable keeps its name: Electron decides `app.isPackaged` from
// it, and a dev run that thinks it is packaged looks for packaged resources and does not start. So
// the process is still "Electron" in dev; the packaged Array.app is Array everywhere. `postinstall` runs it after
// `electron-dist-cache.ts save`, so the shared Electron cache keeps the original bundle; the next
// install restores `Electron.app` and this script renames it again. The bundle's signature covers
// Info.plist, so it is signed again ad hoc, as Electron ships it, and LaunchServices is told about the
// new name so it does not show a cached "Electron".

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const APP_NAME = "Array";
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const logger = createOpenBotLogger("bubbles-dev-name");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronRoot = join(root, "node_modules", "electron");
const dist = join(electronRoot, "dist");
const original = join(dist, "Electron.app");
const renamed = join(dist, `${APP_NAME}.app`);
const pathFile = join(electronRoot, "path.txt");
const binaryPath = `${APP_NAME}.app/Contents/MacOS/Electron`;

function read(plist: string, key: string): string | null {
  try {
    return execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Names the bundle Array. False when it already was, so it is not signed again for nothing. */
function nameBundle(bundle: string): boolean {
  const plist = join(bundle, "Contents", "Info.plist");
  if (read(plist, "CFBundleName") === APP_NAME && read(plist, "CFBundleDisplayName") === APP_NAME) return false;
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    execFileSync("plutil", ["-replace", key, "-string", APP_NAME, plist]);
  }
  return true;
}

if (process.platform !== "darwin" || (!existsSync(original) && !existsSync(renamed))) {
  logger.info("No macOS Electron bundle to name; nothing to do.");
} else {
  try {
    // A fresh install (or a restored cache clone) brings back Electron.app: it replaces the old rename.
    if (existsSync(original)) {
      if (existsSync(renamed)) rmSync(renamed, { recursive: true, force: true });
      renameSync(original, renamed);
    }
    if (nameBundle(renamed)) {
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", renamed], { stdio: "ignore" });
    }
    if (!existsSync(pathFile) || readFileSync(pathFile, "utf8") !== binaryPath) writeFileSync(pathFile, binaryPath);
    execFileSync(LSREGISTER, ["-f", renamed], { stdio: "ignore" });
    logger.info(`The dev Electron app is ${APP_NAME}.app. Restart \`bun run dev\` to see the name.`);
  } catch (error) {
    // A name is cosmetic: an install never fails over it.
    logger.warn("Could not rename the dev Electron app:", toLogValue(error));
  }
}
