// Debug overlay: draw numbered boxes over the elements get_state() found,
// so you can visually confirm what the extractor indexed.

import type { ActionResult } from "./click";

const OVERLAY_ID = "__browser_agent_overlay__";

const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#008080", "#9a6324", "#800000", "#808000", "#000075",
];

export function clearHighlights(): ActionResult {
  document.getElementById(OVERLAY_ID)?.remove();
  return { ok: true };
}

/**
 * Draw a box + index label for each node. Uses live getBoundingClientRect,
 * so call it right after the snapshot the indices came from.
 */
export function drawHighlights(nodes: Element[]): ActionResult {
  clearHighlights();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647", // max — sit above everything
    pointerEvents: "none",
  } as CSSStyleDeclaration);

  nodes.forEach((el, index) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const color = PALETTE[index % PALETTE.length];

    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      border: `2px solid ${color}`,
      boxSizing: "border-box",
      pointerEvents: "none",
    } as CSSStyleDeclaration);

    const label = document.createElement("div");
    label.textContent = String(index);
    Object.assign(label.style, {
      position: "fixed",
      left: `${r.left}px`,
      top: `${Math.max(0, r.top - 14)}px`,
      background: color,
      color: "#fff",
      font: "10px/14px monospace",
      padding: "0 3px",
      pointerEvents: "none",
    } as CSSStyleDeclaration);

    overlay.appendChild(box);
    overlay.appendChild(label);
  });

  (document.body || document.documentElement).appendChild(overlay);
  return { ok: true };
}
