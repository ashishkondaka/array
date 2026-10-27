import { BUBBLES_PRODUCT_NAME } from "@openbot/contracts/fork-identity"; // bubbles: fork name
import { setProductName } from "@openbot/i18n";
import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
import { readBubbleWindowTarget } from "./features/bubbles/bubble-window"; // bubbles: window mode
// Copying a selection with a formula in it gives its LaTeX source, not the typeset glyphs twice.
import "katex/contrib/copy-tex";
import { App } from "./App";
import { startActionSounds } from "./action-sounds";
import { syncAppearance } from "./appearance-choice";
import { readChatWindowTarget } from "./features/window/chat-window";
import { syncLogoColor } from "./logo-color";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

// A startup mark for `dev:bench`, after the bundle is parsed.
performance.mark("openbot:renderer-start");
setProductName(BUBBLES_PRODUCT_NAME); // bubbles: the strings say Array
installPointerFocusGuard();
syncAppearance({ windowGlass: true });
syncLogoColor();
startActionSounds();

// `App` must stay a static import. Main sends the first runtime snapshot on `did-finish-load`,
// which does not wait for a dynamic import, and `App` would subscribe after it. The helper windows
// load `helper.html` instead.
// bubbles: a bubble window is a chat window that draws the bubble.
const bubbleWindow = readBubbleWindowTarget(window.location.search);
render(
  () => (
    <App chatWindow={readChatWindowTarget(window.location.search) ?? bubbleWindow} bubble={bubbleWindow !== null} />
  ),
  root,
);
