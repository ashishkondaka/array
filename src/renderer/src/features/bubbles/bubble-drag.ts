// The orb's own drag. A drag region would swallow the click that expands the orb, so the orb reads
// the pointer and main moves the window. A press that moves less than the slop is a click.

/** The same slop as `BUBBLE_CLICK_SLOP` in main. */
const CLICK_SLOP = 4;

interface Press {
  startX: number;
  startY: number;
  /** The pointer's offset from the window's top-left corner when it went down. */
  offsetX: number;
  offsetY: number;
  dragging: boolean;
}

export interface BubbleDragOptions {
  /** `attach`: Option (Alt) is held, so a release attaches to the window under the pointer. */
  moveTo: (point: { x: number; y: number; attach: boolean }) => void;
  end: (attach: boolean) => void;
  click: () => void;
  /** The orb is picked up (true) or put down (false): it lifts while it is carried. */
  lift: (lifted: boolean) => void;
}

export function createBubbleDrag(options: BubbleDragOptions) {
  let press: Press | null = null;
  let suppressClick = false;
  let pending: { x: number; y: number; attach: boolean } | null = null;
  let frame = 0;

  // At most one move per frame: a pointer reports faster than a window can move.
  function flushMove(): void {
    frame = 0;
    if (pending) options.moveTo(pending);
    pending = null;
  }

  return {
    pointerDown(event: PointerEvent & { currentTarget: HTMLElement }): void {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      press = {
        startX: event.screenX,
        startY: event.screenY,
        offsetX: event.screenX - window.screenX,
        offsetY: event.screenY - window.screenY,
        dragging: false,
      };
    },
    pointerMove(event: PointerEvent): void {
      if (!press) return;
      if (!press.dragging && Math.hypot(event.screenX - press.startX, event.screenY - press.startY) < CLICK_SLOP)
        return;
      if (!press.dragging) options.lift(true);
      press.dragging = true;
      pending = {
        x: Math.round(event.screenX - press.offsetX),
        y: Math.round(event.screenY - press.offsetY),
        attach: event.altKey,
      };
      if (!frame) frame = requestAnimationFrame(flushMove);
    },
    pointerUp(event: PointerEvent): void {
      const ended = press;
      press = null;
      if (!ended?.dragging) return;
      if (frame) cancelAnimationFrame(frame);
      flushMove();
      suppressClick = true;
      options.lift(false);
      options.end(event.altKey);
    },
    click(): void {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      options.click();
    },
  };
}
