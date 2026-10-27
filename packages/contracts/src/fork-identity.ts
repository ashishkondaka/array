/**
 * bubbles: the name the OpenBot Bubbles fork shows, in every process. Main's `fork-identity.ts`
 * holds the rest of the identity (app id, profile directory); the renderer and the UI need the name
 * alone, for the wordmark, the window titles and the strings, so it lives here, where both can
 * import it. `electron-builder.yml` and `package.json` repeat it for the build.
 */
export const BUBBLES_PRODUCT_NAME = "Array";
