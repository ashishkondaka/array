#!/usr/bin/env bun
// Names the development Electron app "Array" (OpenBot Bubbles fork), so the macOS menu bar, the
// Dock and the app switcher say Array instead of Electron during `bun run dev`. A packaged build
// takes its name from `electron-builder.yml`; only the dev binary needs this.
//
// It edits this checkout's `node_modules/electron/dist` copy only. `postinstall` runs it after
// `electron-dist-cache.ts save`, so the shared Electron cache keeps the original bundle. The
// bundle's signature covers Info.plist, so the bundle is signed again ad hoc, as Electron ships it.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const APP_NAME = "Array";
const logger = createOpenBotLogger("bubbles-dev-name");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "node_modules", "electron", "dist", "Electron.app");
const plist = join(bundle, "Contents", "Info.plist");

function read(key: string): string | null {
  try {
    return execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

if (process.platform !== "darwin" || !existsSync(plist)) {
  logger.info("No macOS Electron bundle to name; nothing to do.");
} else if (read("CFBundleName") === APP_NAME && read("CFBundleDisplayName") === APP_NAME) {
  logger.info(`The dev Electron app is already named ${APP_NAME}.`);
} else {
  try {
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
      execFileSync("plutil", ["-replace", key, "-string", APP_NAME, plist]);
    }
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" });
    logger.info(`Named the dev Electron app ${APP_NAME}. Restart \`bun run dev\` to see it.`);
  } catch (error) {
    // A name is cosmetic: an install never fails over it.
    logger.warn("Could not rename the dev Electron app:", toLogValue(error));
  }
}
