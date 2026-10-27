import type { AttachedSurface } from "@openbot/contracts/ipc";

/** "App — window title", or the app alone when the window has no title. */
export function attachedLabel(surface: AttachedSurface | null): string | null {
  if (!surface) return null;
  const title = surface.title.trim();
  return title ? `${surface.appName} — ${title}` : surface.appName;
}
