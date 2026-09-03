// Scroll action: page-level scrolling and scroll-to-element.

import type { ActionResult } from "./click";

export type ScrollDirection = "up" | "down" | "top" | "bottom";

export interface ScrollOptions {
  direction?: ScrollDirection;
  /** Pixels for up/down. Defaults to ~90% of viewport height. */
  amount?: number;
}

export function scrollPage(opts: ScrollOptions = {}): ActionResult {
  const { direction = "down" } = opts;
  const amount = opts.amount ?? Math.floor(window.innerHeight * 0.9);

  switch (direction) {
    case "down":
      window.scrollBy({ top: amount, behavior: "instant" as ScrollBehavior });
      break;
    case "up":
      window.scrollBy({ top: -amount, behavior: "instant" as ScrollBehavior });
      break;
    case "top":
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      break;
    case "bottom":
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant" as ScrollBehavior,
      });
      break;
    default:
      return { ok: false, error: `unknown direction: ${direction}` };
  }
  return { ok: true };
}

export function scrollToElement(el: Element): ActionResult {
  (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
  return { ok: true };
}
