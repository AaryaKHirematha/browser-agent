// Shared DOM semantics: what counts as interactive, an element's role, its
// accessible name, and structural helpers. Both get_state() (state/dom.ts) and
// the UI graph engine (graph/) build on this so they never disagree.

// What counts as "interactive". Native controls + common ARIA widgets +
// anything explicitly made clickable/focusable.
export const INTERACTIVE_SELECTOR = [
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

export function isInteractive(el: Element): boolean {
  return !!el.matches?.(INTERACTIVE_SELECTOR);
}

/** Collect every element in the tree, piercing open shadow roots (document order). */
export function collectAll(root: ParentNode, out: Element[] = []): Element[] {
  const children = root.querySelectorAll("*");
  for (const el of Array.from(children)) {
    out.push(el);
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) collectAll(shadow, out);
  }
  return out;
}

/** Nearest ancestor Element, crossing an open shadow boundary via the host. */
export function parentElementDeep(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) return root.host;
  return null;
}

export function isEditable(el: Element): boolean {
  if ((el as HTMLElement).isContentEditable) return true;
  if (EDITABLE_TAGS.has(el.tagName)) {
    if (el.tagName === "TEXTAREA") return true;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return !NON_EDITABLE_INPUT_TYPES.has(type);
  }
  return false;
}

/** Best-effort accessible name: aria-label > associated label > text/value/alt. */
export function accessibleText(el: Element): string {
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

  const text = (el as HTMLElement).innerText || el.textContent || "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized) return normalized.slice(0, 200);

  const title = el.getAttribute("title");
  if (title?.trim()) return title.trim();

  return "";
}

/** Explicit `role`, else a useful implicit role for common tags. */
export function elementRole(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
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

export function pickAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEEP_ATTRS) {
    const v = el.getAttribute(name);
    if (v != null && v !== "") out[name] = v.length > 120 ? v.slice(0, 120) : v;
  }
  return out;
}

/** Compact XPath using tag + positional index; pierces normal DOM only. */
export function xpathOf(el: Element): string {
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
