// A one-line notice at the top of an expanded bubble, with one action.

import { Button } from "@openbot/ui";
import { Show } from "solid-js";

export interface BubbleNoticeProps {
  message: string;
  action: string;
  onAction: () => void;
  /** A quieter second choice, such as "Not now". */
  dismiss?: { label: string; onDismiss: () => void } | undefined;
}

export function BubbleNotice(props: BubbleNoticeProps) {
  return (
    <div class="bubble-notice" role="status">
      <span class="bubble-notice-text">{props.message}</span>
      <Show when={props.dismiss}>
        {(dismiss) => (
          <Button variant="ghost" size="sm" type="button" onClick={() => dismiss().onDismiss()}>
            {dismiss().label}
          </Button>
        )}
      </Show>
      <Button variant="secondary" size="sm" type="button" onClick={() => props.onAction()}>
        {props.action}
      </Button>
    </div>
  );
}
