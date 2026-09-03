// The heart of get_state(): find interactive elements and serialize them to JSON.

import type { InteractiveElement, PageState } from "./types";
import { getRect, centerOf, inViewport, scrollMetrics } from "./geometry";
import { isVisible, isDisabled } from "./visibility";

// What counts as "interactive". Covers native controls + common ARIA widgets +
// anything explicitly made clickable/focusable.
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "details",
  "label",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=combobox]",
  "[role=textbox]",
  "[role=searchbox]",
  "[role=slider]",
  "[contenteditable=true]",
  "[contenteditable='']",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA"]);
const NON_EDITABLE_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
]);

/** Collect every element in the tree, piercing open shadow roots. */
function collectAll(root: ParentNode, out: Element[] = []): Element[] {
  const children = root.querySelectorAll("*");
  for (const el of Array.from(children)) {
    out.push(el);
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) collectAll(shadow, out);
  }
  return out;
}

function isEditable(el: Element): boolean {
  if ((el as HTMLElement).isContentEditable) return true;
  if (EDITABLE_TAGS.has(el.tagName)) {
    if (el.tagName === "TEXTAREA") return true;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return !NON_EDITABLE_INPUT_TYPES.has(type);
  }
  return false;
}

/** Best-effort accessible name: aria-label > associated label > text/value/alt. */
function accessibleText(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const labels = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (labels.length) return labels.join(" ");
  }

  const html = el as HTMLElement;
  if (EDITABLE_TAGS.has(el.tagName) || el.tagName === "SELECT") {
    // Prefer a <label for> / wrapping label, then placeholder.
    const id = el.id;
    if (id) {
      const forLabel = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
    const ph = el.getAttribute("placeholder");
    if (ph?.trim()) return ph.trim();
  }

  if (el.tagName === "IMG") {
    const alt = el.getAttribute("alt");
    if (alt?.trim()) return alt.trim();
  }

  const text = html.innerText || el.textContent || "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized) return normalized.slice(0, 200);

  const title = el.getAttribute("title");
  if (title?.trim()) return title.trim();

  return "";
}

function role(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  // A few useful implicit roles.
  switch (el.tagName) {
    case "A":
      return el.hasAttribute("href") ? "link" : null;
    case "BUTTON":
      return "button";
    case "SELECT":
      return "combobox";
    case "TEXTAREA":
      return "textbox";
    case "INPUT": {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "range") return "slider";
      if (t === "button" || t === "submit" || t === "reset") return "button";
      return "textbox";
    }
    default:
      return null;
  }
}

const KEEP_ATTRS = [
  "id",
  "name",
  "type",
  "placeholder",
  "title",
  "alt",
  "value",
  "href",
  "aria-label",
  "aria-expanded",
  "aria-checked",
  "aria-selected",
  "data-testid",
];

function pickAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEEP_ATTRS) {
    const v = el.getAttribute(name);
    if (v != null && v !== "") out[name] = v.length > 120 ? v.slice(0, 120) : v;
  }
  return out;
}

/** Compact XPath using tag + positional index; pierces normal DOM only. */
function xpathOf(el: Element): string {
  if (el.id) return `//*[@id="${el.id}"]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    let ix = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === node.tagName) ix++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}[${ix}]`);
    node = node.parentElement;
  }
  return "/html/" + parts.join("/");
}

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
    elements.push({
      index,
      tag: el.tagName.toLowerCase(),
      role: role(el),
      type: el.getAttribute("type"),
      text: accessibleText(el),
      value: (el as HTMLInputElement).value ?? null,
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
