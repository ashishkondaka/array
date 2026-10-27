// The bubble as a worker whose office is the desktop (OpenBot Bubbles fork). A free bubble is told
// that the apps of this Mac are where its work is, and it has one tool, `go_to_app`, that sends it
// there: main moves the orb onto the app's front window and attaches it, after which the attached
// window block (`attached-window-context.ts`) and the Computer Use tools do the rest. Nothing here
// acts on the desktop: the tool only reads where the windows are and moves OpenBot's own orb. Opening
// an app, reading it and acting in it stay with the agent's Computer Use tools and approval policy.

import type { BubbleBounds } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import type { DynamicToolCallParams } from "../protocol";

export const DESKTOP_BLOCK_START = "<openbot_desktop>";
const DESKTOP_BLOCK_END = "</openbot_desktop>";

export const GO_TO_APP_TOOL = "go_to_app";

export const goToAppToolSchema = z.strictObject({
  app: z.string().trim().min(1).max(80),
});

export const DESKTOP_WORKER_TOOL_DEFINITIONS = [
  {
    name: GO_TO_APP_TOOL,
    description:
      "Go to an app on this Mac. Your bubble moves onto the app's front window and attaches to it, so you read and act in that window with the Computer Use tools (get_window_state first, scoped to the pid and window_id the result gives). Pass the app's name as macOS shows it: Mail, Calendar, Notes, Messages, Safari, Finder, Slack. If the app is not running, the result says so with its bundle_id: launch it with the Computer Use tool launch_app, then call go_to_app again.",
    shape: goToAppToolSchema.shape,
  },
] as const;

export function isDesktopWorkerTool(name: string): boolean {
  return name === GO_TO_APP_TOOL;
}

/** What main answers when a bubble is sent to an app. */
export type GoToAppResult =
  | {
      status: "attached";
      app: string;
      title: string;
      pid: number;
      windowId: number;
      bounds: BubbleBounds;
      browserUrl: string | null;
    }
  | { status: "not-running"; app: string; bundleId: string | null; launchPath: string | null }
  | { status: "no-window"; app: string; pid: number; bundleId: string | null }
  | { status: "unknown-app"; app: string }
  | { status: "no-bubble" }
  | { status: "driver-unavailable"; reason: string }
  | { status: "failed"; message: string };

export interface DesktopWorkerHost {
  goToApp: (agentId: string, app: string) => Effect.Effect<GoToAppResult>;
  /** Whether the agent has a bubble on the desktop that is not attached to a window. */
  freeBubble: (agentId: string) => boolean;
}

let host: DesktopWorkerHost | null = null;

export function setDesktopWorkerHost(next: DesktopWorkerHost | null): void {
  host = next;
}

/** Whether the agent's turn gets the desktop block: it has a free bubble. */
export function hasFreeBubble(agentId: string): boolean {
  return host?.freeBubble(agentId) ?? false;
}

/**
 * What a free bubble reads at the start of each turn. Short and static: the agent finds out what is
 * open with its own tools when it needs to, and the result of `go_to_app` carries the window.
 */
export function desktopWorkerBlock(): string {
  return [
    DESKTOP_BLOCK_START,
    "You are a bubble on the user's Mac desktop: a worker whose office is the screen. When the user asks",
    "about something an app on this Mac shows or does (their mail, calendar, notes, messages, a document,",
    "a page they have open), work in that app, not in the embedded browser and not from memory: call the",
    `OpenBot tool ${GO_TO_APP_TOOL} with the app's name (for example "Mail"). Your bubble then moves onto the`,
    "app's front window and attaches to it, and the result names the window: read it with the Computer Use",
    "tool get_window_state (pid and window_id from the result) and act there with Computer Use tools",
    `scoped to it. Opening the app is your job, never the user's: when ${GO_TO_APP_TOOL} says the app is not`,
    "running, call the Computer Use tool launch_app (bundle_id from the result); when it says the app has",
    "no window on this screen, call bring_to_front with its pid (that is the click on its Dock icon: it",
    `brings the app's window to this screen); then call ${GO_TO_APP_TOOL} again. Do not ask the user to open`,
    `or switch to an app. When the user's next request is about another app, call ${GO_TO_APP_TOOL} for that`,
    "one: you move there. Say in a few words where you went. Ask before anything that sends, deletes or pays.",
    DESKTOP_BLOCK_END,
  ].join("\n");
}

/** The `go_to_app` call: checks the arguments, asks main to move the bubble, and words the answer. */
export function desktopWorkerTool(
  agentId: string | null,
  params: DynamicToolCallParams,
): Effect.Effect<OpenBotToolResponse> {
  if (!agentId) return Effect.succeed(openBotToolFailure("This tool call does not belong to an agent."));
  const parsed = goToAppToolSchema.safeParse(params.arguments);
  if (!parsed.success)
    return Effect.succeed(openBotToolFailure(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`));
  if (!host) return Effect.succeed(openBotToolFailure("Bubbles are not available in this app."));
  return host.goToApp(agentId, parsed.data.app).pipe(Effect.map(wordResult));
}

function wordResult(result: GoToAppResult): OpenBotToolResponse {
  switch (result.status) {
    case "attached":
      return openBotToolResult({
        ...result,
        next: `Your bubble is on this window. Call get_window_state with pid ${result.pid} and window_id ${result.windowId}, then work in this window with Computer Use tools scoped to it.`,
      });
    case "not-running":
      return openBotToolResult({
        ...result,
        next: `${result.app} is not running. Open it yourself, do not ask the user: call the Computer Use tool launch_app${result.bundleId ? ` with bundle_id ${result.bundleId}` : ` with name ${result.app}`}, wait two seconds, then call ${GO_TO_APP_TOOL} again. If the window is still not on this screen, call bring_to_front with the app's pid first.`,
      });
    case "no-window":
      return openBotToolResult({
        ...result,
        next: `${result.app} is running (pid ${result.pid}) but has no window on this screen: it is on another Space, hidden or minimised. Bring it here yourself, do not ask the user: call the Computer Use tool bring_to_front with pid ${result.pid} (the click on its Dock icon), wait a second, then call ${GO_TO_APP_TOOL} again. If no window appears, call launch_app${result.bundleId ? ` with bundle_id ${result.bundleId}` : ""} to open one, then ${GO_TO_APP_TOOL} again.`,
      });
    case "unknown-app":
      return openBotToolFailure(
        `No app named "${result.app}" is installed or running on this Mac. Use the name macOS shows, or call the Computer Use tool list_apps to find it.`,
      );
    case "no-bubble":
      return openBotToolFailure(
        "This agent has no bubble on the desktop. Ask the user to pop the agent out into a bubble first.",
      );
    case "driver-unavailable":
      return openBotToolFailure(`Computer Use is not available: ${result.reason}. The user turns it on in Settings.`);
    case "failed":
      return openBotToolFailure(`Could not go to the app: ${result.message}`);
  }
}
