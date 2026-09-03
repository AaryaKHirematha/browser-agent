// Geometry helpers: bounding boxes, centers, viewport tests.

import type { Rect, Point } from "./types";

export function getRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** True if any part of the rect overlaps the current viewport. */
export function inViewport(rect: Rect): boolean {
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x < vw &&
    rect.y < vh &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0
  );
}

/** Document-level scroll metrics used to tell the agent if more content exists. */
export function scrollMetrics() {
  const doc = document.documentElement;
  const maxScrollY = Math.max(0, doc.scrollHeight - window.innerHeight);
  const scrollY = window.scrollY;
  return {
    scrollX: window.scrollX,
    scrollY,
    maxScrollY,
    atTop: scrollY <= 1,
    atBottom: scrollY >= maxScrollY - 1,
  };
}
