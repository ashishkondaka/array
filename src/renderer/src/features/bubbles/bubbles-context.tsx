import type { BubbleDragPoint, BubbleState, BubblesSnapshot } from "@openbot/contracts/ipc";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { createMemo, createStore, onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useServers } from "../servers/servers-context";
import { bubblesPort } from "./bubbles-port";

/**
 * The floating bubbles of the local host (OpenBot Bubbles fork). Main owns them; this is its last
 * snapshot and the requests the views make. Bubbles exist for local agents only, so on a remote
 * server every agent reads as not popped out and nothing offers to pop one out.
 */
const Bubbles = createSimpleContext({
  name: "Bubbles",
  init: () => {
    const { activeServerId } = useServers();
    const [state, setState] = createStore<{ snapshot: BubblesSnapshot }>({
      snapshot: { bubbles: [], hidden: false },
    });
    const local = () => activeServerId() === LOCAL_SERVER_ID;

    onSettled(() => {
      const port = bubblesPort();
      const apply = (snapshot: BubblesSnapshot) =>
        setState((draft) => {
          draft.snapshot = snapshot;
        });
      const unsubscribe = port.onChanged(apply);
      void port
        .list()
        .then(apply)
        .catch(() => undefined);
      return unsubscribe;
    });

    const poppedOutIds = createMemo(
      () => new Set(local() ? state.snapshot.bubbles.map((bubble) => bubble.agentId) : []),
    );
    const bubbleOf = (agentId: string): BubbleState | null =>
      state.snapshot.bubbles.find((bubble) => bubble.agentId === agentId) ?? null;
    // A failed request changes nothing; the next snapshot from main still shows the truth.
    const send = (request: Promise<void>) => void request.catch(() => undefined);

    return {
      available: local,
      poppedOutIds,
      bubbleOf,
      popOut: (agentId: string) => send(bubblesPort().open(agentId)),
      bringBack: (agentId: string) => send(bubblesPort().close(agentId)),
      setExpanded: (agentId: string, expanded: boolean) => send(bubblesPort().setExpanded({ agentId, expanded })),
      focusMain: (agentId: string) => send(bubblesPort().focusMain(agentId)),
      dragTo: (point: BubbleDragPoint) => send(bubblesPort().dragTo(point)),
      dragEnd: () => send(bubblesPort().dragEnd()),
    };
  },
});

export const BubblesProvider = Bubbles.provider;
export const useBubbles = Bubbles.use;
