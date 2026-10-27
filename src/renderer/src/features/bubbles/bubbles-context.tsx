import type {
  BubbleAttachIssue,
  BubbleCharacterId,
  BubbleDragPoint,
  BubbleState,
  BubblesSnapshot,
  MacPermissionId,
} from "@openbot/contracts/ipc";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { createMemo, createStore, onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useServers } from "../servers/servers-context";
import { bubblesPort } from "./bubbles-port";

/**
 * The floating bubbles of the local host (OpenBot Bubbles fork). Main owns them; this is its last
 * snapshot, the attach status it last sent, and the requests the views make. Bubbles exist for local
 * agents only, so on a remote server every agent reads as not popped out and nothing offers one.
 */
const Bubbles = createSimpleContext({
  name: "Bubbles",
  init: () => {
    const { activeServerId } = useServers();
    const [state, setState] = createStore<{
      snapshot: BubblesSnapshot;
      issues: Record<string, BubbleAttachIssue | undefined>;
      /** The app a dragged orb would attach to on release, while it rests over its window. */
      hints: Record<string, string | undefined>;
      /** Counts the greets main asked each bubble to play; a change plays one. */
      greets: Record<string, number | undefined>;
    }>({
      snapshot: { bubbles: [], hidden: false, characters: [], nudges: true },
      issues: {},
      hints: {},
      greets: {},
    });
    const local = () => activeServerId() === LOCAL_SERVER_ID;

    onSettled(() => {
      const port = bubblesPort().bubbles;
      const apply = (snapshot: BubblesSnapshot) =>
        setState((draft) => {
          draft.snapshot = snapshot;
        });
      const unsubscribe = port.onChanged(apply);
      const unsubscribeStatus = port.onAttachStatus(({ agentId, issue }) =>
        setState((draft) => {
          draft.issues[agentId] = issue ?? undefined;
        }),
      );
      void port
        .list()
        .then(apply)
        .catch(() => undefined);
      const unsubscribeHint = port.onAttachHint(({ agentId, app }) =>
        setState((draft) => {
          draft.hints[agentId] = app ?? undefined;
        }),
      );
      const unsubscribeCue = port.onMotionCue(({ agentId }) =>
        setState((draft) => {
          draft.greets[agentId] = (draft.greets[agentId] ?? 0) + 1;
        }),
      );
      return () => {
        unsubscribe();
        unsubscribeStatus();
        unsubscribeHint();
        unsubscribeCue();
      };
    });

    const poppedOutIds = createMemo(
      () => new Set(local() ? state.snapshot.bubbles.map((bubble) => bubble.agentId) : []),
    );
    const bubbleOf = (agentId: string): BubbleState | null =>
      state.snapshot.bubbles.find((bubble) => bubble.agentId === agentId) ?? null;
    const characterOf = (agentId: string): BubbleCharacterId | null =>
      state.snapshot.characters.find((choice) => choice.agentId === agentId)?.character ?? null;
    // A failed request changes nothing; the next snapshot from main still shows the truth.
    const send = (request: Promise<unknown>) => void request.catch(() => undefined);
    const port = () => bubblesPort().bubbles;

    return {
      available: local,
      poppedOutIds,
      bubbleOf,
      characterOf,
      nudges: () => state.snapshot.nudges,
      issueOf: (agentId: string) => state.issues[agentId] ?? null,
      hintOf: (agentId: string) => state.hints[agentId] ?? null,
      greetsOf: (agentId: string) => state.greets[agentId] ?? 0,
      bubbleCount: () => state.snapshot.bubbles.length,
      visit: () => send(port().visit()),
      dismissIssue: (agentId: string) =>
        setState((draft) => {
          draft.issues[agentId] = undefined;
        }),
      popOut: (agentId: string) => send(port().open(agentId)),
      bringBack: (agentId: string) => send(port().close(agentId)),
      setExpanded: (agentId: string, expanded: boolean) => send(port().setExpanded({ agentId, expanded })),
      focusMain: (agentId: string) => send(port().focusMain(agentId)),
      setCharacter: (agentId: string, character: BubbleCharacterId | null) =>
        send(port().setCharacter({ agentId, character })),
      nudge: () => send(port().nudge()),
      detach: (agentId: string) => send(port().detach(agentId)),
      openAttachedInBrowser: (agentId: string) => send(port().openAttachedInBrowser(agentId)),
      openPermissionPane: (permission: MacPermissionId) =>
        send(bubblesPort().computerUse.openPermissionPane(permission)),
      dragTo: (point: BubbleDragPoint) => send(port().dragTo(point)),
      dragEnd: (attach: boolean) => send(port().dragEnd(attach)),
    };
  },
});

export const BubblesProvider = Bubbles.provider;
export const useBubbles = Bubbles.use;
