// Type action: set the value of an input/textarea/contenteditable so that
// framework listeners (React/Vue) observe the change.

import type { ActionResult } from "./click";

/** Use the prototype setter so React's value tracker sees the update. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

export interface TypeOptions {
  /** Clear existing content first. Default true. */
  clear?: boolean;
  /** Dispatch an Enter keydown/keyup after typing (submits many forms). */
  pressEnter?: boolean;
}

export function typeText(el: Element, text: string, opts: TypeOptions = {}): ActionResult {
  const { clear = true, pressEnter = false } = opts;
  const html = el as HTMLElement;

  try {
    html.focus({ preventScroll: true });
  } catch {
    /* best-effort */
  }

  if (html.isContentEditable) {
    if (clear) el.textContent = "";
    el.textContent = (el.textContent || "") + text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text }));
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const next = clear ? text : (el.value || "") + text;
    setNativeValue(el, next);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    return { ok: false, error: "element is not editable" };
  }

  if (pressEnter) {
    const enter: KeyboardEventInit = {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
    } as KeyboardEventInit;
    el.dispatchEvent(new KeyboardEvent("keydown", enter));
    el.dispatchEvent(new KeyboardEvent("keyup", enter));
  }

  return { ok: true };
}
