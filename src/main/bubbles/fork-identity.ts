// The identity of the OpenBot Bubbles fork, named Array. A packaged fork must not share the app id, the
// `userData` directory or the single-instance lock of an installed OpenBot, so both can run at once.
// `electron-builder.yml` and `package.json` repeat these values for the build.

import { BUBBLES_PRODUCT_NAME } from "@openbot/contracts/fork-identity";

/** The name, shared with the renderer through `@openbot/contracts/fork-identity`. */
export const BUBBLES_APP_NAME = BUBBLES_PRODUCT_NAME;
export const BUBBLES_APP_ID = "app.array.desktop";
export const BUBBLES_USER_DATA_NAME = "Array";
// The preview icon stands in for a fork icon until one is drawn.
export const BUBBLES_PACKAGED_ICON_VARIANT = "preview";

// The fork must never install an upstream OpenBot release over itself. Updates stay off unless
// `OPENBOT_BUBBLES_ENABLE_UPDATES=1`, which a fork with its own release feed can set.
export function bubblesUpdatesAllowed(environment: NodeJS.ProcessEnv): boolean {
  return environment.OPENBOT_BUBBLES_ENABLE_UPDATES === "1";
}
