// bubbles: the product name the app shows. The catalogs name the product "OpenBot" in thousands of
// messages across the locales, and a fork must not rewrite them: `createTranslate` swaps the name in
// a message's text instead, once the app has set its own. It swaps the message, not the values
// interpolated into it, so a server or a team named "OpenBot …" keeps its name. An app that sets no
// name (the mobile app) renders the catalogs as written.

const UPSTREAM_PRODUCT_NAME = "OpenBot";

let current = UPSTREAM_PRODUCT_NAME;

/** Call once at startup, before the first render. */
export function setProductName(name: string): void {
  current = name;
}

/** The name the app shows where a component writes the product name itself (the wordmark). */
export function productName(): string {
  return current;
}

/** A message's text with the product name the app shows. */
export function brandText(text: string): string {
  if (current === UPSTREAM_PRODUCT_NAME || !text.includes(UPSTREAM_PRODUCT_NAME)) return text;
  return text.replaceAll(UPSTREAM_PRODUCT_NAME, current);
}
