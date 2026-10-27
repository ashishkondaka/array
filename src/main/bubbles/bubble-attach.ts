// Drag-to-attach: a bubble dropped on another app's window attaches its agent to that window.
//
// The window under the pointer comes from the Computer Use driver's own window list, over the
// daemon that OpenBot spawned, so the macOS grants stay OpenBot's. Attaching only changes what the
// agent is told each turn (`attached-window-context.ts`); every action it then takes goes through
// the normal Computer Use tools and the agent's approval policy.

import {
  BUBBLE_LIMITS,
  type BubbleAttachIssue,
  type BubbleBounds,
  type ComputerUseState,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { setAttachedWindowSource } from "../../backend/bubbles/attached-window-context";
import {
  attachedSurface,
  type DesktopWindow,
  dropOutcome,
  dropTarget,
  followAttachment,
  isKnownBrowser,
  readBrowserAddress,
  readDesktopWindows,
  snappedPosition,
} from "./attach-target";
import { separateOrb } from "./bubble-layout";
import type { BubbleWindowManager } from "./bubble-window-manager";

const logger = createOpenBotLogger("bubbles-attach");

/** How often an attached bubble looks for its window: to follow a move and to notice a close. */
const FOLLOW_INTERVAL_MS = 2_000;
/** An attached orb is wider: its chip sits left of it. */
const ATTACHED_WIDTH_DELTA = BUBBLE_LIMITS.attachedOrbWidth - BUBBLE_LIMITS.orbSize;

export interface WindowReads {
  listWindows: () => Effect.Effect<unknown, unknown>;
  windowState: (pid: number, windowId: number, query: string) => Effect.Effect<unknown, unknown>;
}

export interface BubbleAttachOptions {
  bubbles: BubbleWindowManager;
  reads: WindowReads;
  /** Whether the driver is up with its grants, so its window list can be read. */
  driverReady: () => boolean;
  driverState: () => ComputerUseState;
  ownPid: number;
  /** The driver's ids for the bubble windows (the CGWindowID on macOS, the HWND on Windows). */
  bubbleWindowIds: () => Set<number>;
  /** The driver reports physical pixels on Windows; Electron places windows in DIP. */
  toDesktopRect: (rect: BubbleBounds) => BubbleBounds;
  openInBrowser: (agentId: string, url: string) => Effect.Effect<unknown, unknown>;
  reportIssue: (agentId: string, issue: BubbleAttachIssue | null) => void;
}

export function attachIssue(state: ComputerUseState): BubbleAttachIssue {
  if (state.status === "unsupported") return "unsupported-platform";
  if (state.status === "permissions-required") {
    const missing = state.permissions.find((permission) => !permission.granted);
    return missing?.id === "accessibility" ? "permission-accessibility" : "permission-screen-recording";
  }
  return "driver-unavailable";
}

export class BubbleAttachController {
  readonly #options: BubbleAttachOptions;
  #follow: ReturnType<typeof setInterval> | null = null;

  constructor(options: BubbleAttachOptions) {
    this.#options = options;
    options.bubbles.setDropHandler((agentId, pointer) => {
      void Effect.runPromise(this.#drop(agentId, pointer));
    });
    setAttachedWindowSource((agentId) => options.bubbles.bubble(agentId)?.attached ?? null);
    this.#syncFollow();
  }

  detach(agentId: string): void {
    this.#options.bubbles.replace(agentId, (bubble) =>
      // The orb stays where its right end was: an attached orb is wider, with its chip to the left.
      bubble.attached ? { ...bubble, attached: null, x: bubble.x + ATTACHED_WIDTH_DELTA } : bubble,
    );
    this.#syncFollow();
  }

  openInBrowser(agentId: string): Effect.Effect<void> {
    const url = this.#options.bubbles.bubble(agentId)?.attached?.browserUrl;
    if (!url) return Effect.void;
    return this.#options.openInBrowser(agentId, url).pipe(
      Effect.asVoid,
      Effect.catch((error) => Effect.sync(() => logger.warn("Could not open the page in OpenBot:", toLogValue(error)))),
    );
  }

  stop(): void {
    if (this.#follow) clearInterval(this.#follow);
    this.#follow = null;
  }

  #windows(): Effect.Effect<DesktopWindow[], unknown> {
    return this.#options.reads.listWindows().pipe(
      Effect.map((payload) =>
        readDesktopWindows(payload).map((window) => ({
          ...window,
          bounds: this.#options.toDesktopRect(window.bounds),
        })),
      ),
    );
  }

  #drop(agentId: string, pointer: { x: number; y: number }): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const bubble = this.#options.bubbles.bubble(agentId);
      if (!bubble || bubble.expanded) return;
      if (!this.#options.driverReady()) {
        // Without the driver there is no window list. An attached bubble moved off its window by hand
        // still detaches; a free one is only told what to turn on.
        if (bubble.attached) this.detach(agentId);
        this.#options.reportIssue(agentId, attachIssue(this.#options.driverState()));
        return;
      }
      const windows = yield* this.#windows();
      const target = dropTarget(windows, pointer, this.#options.ownPid, this.#options.bubbleWindowIds());
      const outcome = dropOutcome(bubble, target);
      this.#options.reportIssue(agentId, null);
      if (outcome.kind === "detach") {
        this.detach(agentId);
        return;
      }
      if (outcome.kind === "none") return;
      const window = outcome.kind === "attach" ? outcome.window : target;
      if (!window) return;
      const browserUrl =
        outcome.kind === "attach" ? yield* this.#browserAddress(window) : (bubble.attached?.browserUrl ?? null);
      const others = this.#options.bubbles.snapshot().bubbles.filter((other) => other.agentId !== agentId);
      this.#options.bubbles.replace(agentId, (current) => ({
        ...current,
        attached: outcome.kind === "attach" ? attachedSurface(window, Date.now(), browserUrl) : current.attached,
        ...separateOrb(snappedPosition(window.bounds), others),
      }));
      this.#syncFollow();
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("Could not read the window under a dropped bubble:", toLogValue(error));
          this.#options.reportIssue(agentId, "driver-unavailable");
        }),
      ),
    );
  }

  /** The page address of a known browser, or null. A failed read only loses the browser offer. */
  #browserAddress(window: DesktopWindow): Effect.Effect<string | null> {
    if (!isKnownBrowser(window.appName)) return Effect.succeed(null);
    return this.#options.reads.windowState(window.pid, window.windowId, "address").pipe(
      Effect.map(readBrowserAddress),
      Effect.catch(() => Effect.succeed(null)),
    );
  }

  /** Polls only while a bubble is attached, so a desktop of free orbs costs nothing. */
  #syncFollow(): void {
    const attached = this.#options.bubbles.snapshot().bubbles.some((bubble) => bubble.attached);
    if (attached && !this.#follow) {
      this.#follow = setInterval(() => void Effect.runPromise(this.#followTick()), FOLLOW_INTERVAL_MS);
    } else if (!attached) this.stop();
  }

  #followTick(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#options.driverReady()) return;
      const windows = yield* this.#windows();
      for (const bubble of this.#options.bubbles.snapshot().bubbles) {
        if (!bubble.attached) continue;
        const outcome = followAttachment(bubble.attached, windows);
        if (outcome.kind === "gone") this.detach(bubble.agentId);
        else if (outcome.kind === "moved") {
          this.#options.bubbles.replace(bubble.agentId, (current) =>
            current.attached
              ? {
                  ...current,
                  attached: { ...current.attached, bounds: outcome.bounds, title: outcome.title },
                  // An open panel stays where the user has it; a collapsed orb rides the window.
                  ...(current.expanded ? {} : snappedPosition(outcome.bounds)),
                }
              : current,
          );
        }
      }
      this.#syncFollow();
    }).pipe(Effect.catch(() => Effect.void));
  }
}
