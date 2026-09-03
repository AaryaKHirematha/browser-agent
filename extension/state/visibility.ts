// Visibility / interactability checks. Filters out elements the user can't see or use.

import { getRect, centerOf } from "./geometry";

/** Cheap style + box test. Does not walk ancestors for perf. */
export function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.hidden) return false;

  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  ) {
    return false;
  }
  if (parseFloat(style.opacity || "1") === 0) return false;

  const rect = getRect(el);
  if (rect.width <= 0 || rect.height <= 0) return false;

  return true;
}

export function isDisabled(el: Element): boolean {
  if ((el as HTMLInputElement).disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  return false;
}

/**
 * Occlusion test: is `el` the topmost element at its own center?
 * Guards against elements hidden behind overlays/modals. Best-effort —
 * accepts a descendant/ancestor hit as "reachable".
 */
export function isHittable(el: Element): boolean {
  const rect = getRect(el);
  if (rect.width <= 0 || rect.height <= 0) return false;

  const { x, y } = centerOf(rect);
  // Only meaningful if the center is actually on screen.
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return true; // off-screen but scrollable-to; don't reject here
  }

  const top = document.elementFromPoint(x, y);
  if (!top) return true;
  return el === top || el.contains(top) || top.contains(el);
}
