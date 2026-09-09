// The heart of get_state(): find interactive elements and serialize them to JSON.

import type { InteractiveElement, PageState } from "./types";
import { getRect, centerOf, inViewport, scrollMetrics } from "./geometry";
import { isVisible, isDisabled } from "./visibility";
import {
  INTERACTIVE_SELECTOR,
  collectAll,
  isEditable,
  accessibleText,
  elementRole as role,
  pickAttributes,
  xpathOf,
} from "./semantic";

/**
 * Extract the current page state. Returns the JSON-serializable `state`
 * plus the aligned `nodes` array so callers can resolve `index` → Element.
 */
export function extractState(): { state: PageState; nodes: Element[] } {
  const all = collectAll(document);
  const nodes: Element[] = [];
  const elements: InteractiveElement[] = [];
  const seen = new Set<Element>();

  let index = 0;
  for (const el of all) {
    if (seen.has(el)) continue;
    if (!el.matches?.(INTERACTIVE_SELECTOR)) continue;
    if (!isVisible(el)) continue;
    seen.add(el);

    const rect = getRect(el);
    const typeAttr = (el.getAttribute("type") || "").toLowerCase();
    const isPasswordType = typeAttr === "password" || role(el) === "password";
    const rawValue = (el as HTMLInputElement).value ?? null;
    const value = isPasswordType ? "[PASSWORD_REDACTED]" : rawValue;

    elements.push({
      index,
      tag: el.tagName.toLowerCase(),
      role: role(el),
      type: el.getAttribute("type"),
      text: isPasswordType ? "[PASSWORD_REDACTED]" : accessibleText(el),
      value,
      placeholder: el.getAttribute("placeholder"),
      ariaLabel: el.getAttribute("aria-label"),
      href: (el as HTMLAnchorElement).href || null,
      editable: isEditable(el),
      disabled: isDisabled(el),
      inViewport: inViewport(rect),
      rect,
      center: centerOf(rect),
      xpath: xpathOf(el),
      attributes: pickAttributes(el),
    });
    nodes.push(el);
    index++;
  }

  const scroll = scrollMetrics();
  const state: PageState = {
    url: location.href,
    title: document.title,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: scroll.scrollX,
      scrollY: scroll.scrollY,
      devicePixelRatio: window.devicePixelRatio,
    },
    scroll: {
      atTop: scroll.atTop,
      atBottom: scroll.atBottom,
      maxScrollY: scroll.maxScrollY,
    },
    elements,
  };

  return { state, nodes };
}
