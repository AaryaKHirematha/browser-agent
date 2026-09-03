// Click action: dispatch a realistic pointer/mouse sequence, then native click.

import { getRect, centerOf } from "../state/geometry";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export function clickElement(el: Element): ActionResult {
  const html = el as HTMLElement;

  html.scrollIntoView({ block: "center", inline: "center" });

  const rect = getRect(el);
  const { x, y } = centerOf(rect);
  const base: MouseEventInit & PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
  };

  try {
    if (typeof html.focus === "function") html.focus({ preventScroll: true });
  } catch {
    /* focus is best-effort */
  }

  el.dispatchEvent(new PointerEvent("pointerdown", base));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  el.dispatchEvent(new PointerEvent("pointerup", base));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  el.dispatchEvent(new MouseEvent("click", base));

  // Native click covers default actions (link navigation, form submit, label toggling)
  // that synthetic events alone may not trigger.
  if (typeof html.click === "function") html.click();

  return { ok: true };
}
