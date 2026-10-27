// A one-line notice at the top of an expanded bubble, with one action.

import { Button } from "@openbot/ui";

export interface BubbleNoticeProps {
  message: string;
  action: string;
  onAction: () => void;
}

export function BubbleNotice(props: BubbleNoticeProps) {
  return (
    <div class="bubble-notice" role="status">
      <span class="bubble-notice-text">{props.message}</span>
      <Button variant="secondary" size="sm" type="button" onClick={() => props.onAction()}>
        {props.action}
      </Button>
    </div>
  );
}
