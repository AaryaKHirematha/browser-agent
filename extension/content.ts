// Content script: runs in every frame, owns get_state() and dispatches actions.
//
// The agent talks to this via chrome.tabs.sendMessage (relayed by background.ts).
// It keeps a per-snapshot registry (index -> Element) so actions can target the
// element the agent saw in the last get_state().
//
// Frame policy (Phase 1): only the TOP frame answers messages. The script is
// injected into all frames, but sub-frames stay inert so the console/agent gets
// one deterministic page state instead of a race between frames. Cross-frame
// extraction is a Phase 2 concern.

import { extractState } from "./state/dom";
import { clickElement } from "./actions/click";
import { typeText } from "./actions/type";
import { scrollPage, scrollToElement } from "./actions/scroll";
import { drawHighlights, clearHighlights } from "./actions/highlight";
import type { PageState } from "./state/types";

// Latest snapshot's element handles, aligned to PageState.elements[i].index.
let registry: Element[] = [];

function getState(): PageState {
  clearHighlights(); // don't let stale overlay boxes linger across snapshots
  const { state, nodes } = extractState();
  registry = nodes;
  return state;
}

function resolve(index: number): Element {
  const el = registry[index];
  if (!el) {
    throw new Error(
      `no element for index ${index}; call get_state first (registry has ${registry.length})`,
    );
  }
  if (!el.isConnected) {
    throw new Error(`element ${index} is detached; page changed — call get_state again`);
  }
  return el;
}

export type Message =
  | { type: "GET_STATE" }
  | { type: "CLICK"; index: number }
  | { type: "TYPE"; index: number; text: string; clear?: boolean; pressEnter?: boolean }
  | { type: "SCROLL"; direction?: "up" | "down" | "top" | "bottom"; amount?: number }
  | { type: "SCROLL_TO"; index: number }
  | { type: "HIGHLIGHT" }
  | { type: "CLEAR_HIGHLIGHT" }
  | { type: "PING" };

function handle(msg: Message): unknown {
  switch (msg.type) {
    case "PING":
      return { ok: true, frame: location.href };
    case "GET_STATE":
      return { ok: true, state: getState() };
    case "CLICK":
      return clickElement(resolve(msg.index));
    case "TYPE":
      return typeText(resolve(msg.index), msg.text, {
        clear: msg.clear,
        pressEnter: msg.pressEnter,
      });
    case "SCROLL":
      return scrollPage({ direction: msg.direction, amount: msg.amount });
    case "SCROLL_TO":
      return scrollToElement(resolve(msg.index));
    case "HIGHLIGHT": {
      // Refresh the snapshot so indices match the boxes we draw.
      getState();
      const res = drawHighlights(registry);
      return { ...res, count: registry.length };
    }
    case "CLEAR_HIGHLIGHT":
      return clearHighlights();
    default:
      return { ok: false, error: `unknown message: ${(msg as { type: string }).type}` };
  }
}

const isTopFrame = window.top === window;

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  // Only the top frame participates; sub-frames stay silent so they don't win
  // the response race with a partial/empty state.
  if (!isTopFrame) return false;

  try {
    sendResponse(handle(msg));
  } catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  // Synchronous response; return false so the channel closes immediately.
  return false;
});
