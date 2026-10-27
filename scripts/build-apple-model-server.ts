#!/usr/bin/env bun
// bubbles: builds the Apple on-device model server (`resources/apple-model-server/main.swift`) into
// `build/apple-model-server/darwin/<arch>/apple-model-server`, which electron-builder ships as
// `resources/apple-model-server/darwin/<arch>`. The server needs macOS 26 and the FoundationModels
// framework at run time; it is built on any Mac with Xcode's Swift. Elsewhere, or without `swiftc`,
// nothing is built and the app runs without the Apple model: `dist:mac` must not fail over it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("build-apple-model-server");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "resources", "apple-model-server", "main.swift");
const architecture = process.argv[2] ?? process.arch;
const output = join(root, "build", "apple-model-server", "darwin", architecture, "apple-model-server");

if (process.platform !== "darwin") {
  logger.info("Not macOS: the Apple model server is not built.");
} else {
  try {
    mkdirSync(dirname(output), { recursive: true });
    // Through `xcrun`, which sets the SDK: `swiftc` called by its path cannot load the standard library.
    execFileSync("xcrun", ["swiftc", "-O", "-target", `${architecture}-apple-macos26.0`, "-o", output, source], {
      stdio: "inherit",
    });
    logger.info(`Built ${output}`);
  } catch (error) {
    // No Xcode Swift (or a build error): the app ships without the Apple model, and says so at run time.
    logger.warn("The Apple model server was not built:", toLogValue(error));
    if (!existsSync(output)) logger.warn("The packaged app will offer no Apple on-device model.");
  }
}
