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
import { IncrementalGraphEngine } from "./graph/engine";
import { DomObserver } from "./graph/observer";
import { project, type ProjectOptions } from "./graph/project";
import type { GraphMutation, GraphSnapshot } from "./graph/types";

// Latest snapshot's element handles, aligned to the indices last handed out
// (by get_state OR by the graph projection — whichever ran most recently).
let registry: Element[] = [];

function getState(): PageState {
  clearHighlights(); // don't let stale overlay boxes linger across snapshots
  const { state, nodes } = extractState();
  registry = nodes;
  return state;
}

// ---- Semantic UI graph (Layers 2 + 3) --------------------------------------
// Built lazily on first graph request, then kept live by a MutationObserver.

let engine: IncrementalGraphEngine | null = null;
let observer: DomObserver | null = null;

function ensureGraph(): IncrementalGraphEngine {
  if (engine) return engine;
  engine = new IncrementalGraphEngine();
  engine.build();
  observer = new DomObserver((records) => engine!.applyMutations(records));
  observer.start();
  return engine;
}

/** Project the graph for the agent and re-point the action registry at it. */
function getGraph(opts: ProjectOptions) {
  const g = ensureGraph();
  observer?.flushNow(); // fold any pending mutations before reading
  g.refresh(); // re-derive layout-dependent fields (visible/rect/…)
  const projection = project(g, opts);
  registry = projection.elements;
  return {
    url: location.href,
    title: document.title,
    count: projection.count,
    truncated: projection.truncated,
    text: projection.text,
    tree: projection.tree,
  };
}

/** Raw Layer 3 graph snapshot (all nodes + semantic edges). */
function getUiGraph(): GraphSnapshot {
  const g = ensureGraph();
  observer?.flushNow();
  g.refresh();
  return g.graph.toJSON(g.rootId);
}

/** Layer 2 delta: mutations since the last drain. */
function getGraphDelta(): GraphMutation[] {
  const g = ensureGraph();
  observer?.flushNow();
  g.refresh();
  return g.graph.drainMutations();
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
  | {
      type: "GET_GRAPH";
      query?: string;
      roles?: string[];
      includeInvisible?: boolean;
      maxNodes?: number;
    }
  | { type: "GET_UI_GRAPH" }
  | { type: "GRAPH_DELTA" }
  | { type: "DOM_STATS" }
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
    case "GET_GRAPH":
      return {
        ok: true,
        graph: getGraph({
          query: msg.query,
          roles: msg.roles,
          includeInvisible: msg.includeInvisible,
          maxNodes: msg.maxNodes,
        }),
      };
    case "GET_UI_GRAPH":
      return { ok: true, uiGraph: getUiGraph() };
    case "GRAPH_DELTA":
      return { ok: true, delta: getGraphDelta() };
    case "DOM_STATS": {
      // Raw-DOM size baseline, read from the isolated world — no eval, so it
      // works on strict-CSP pages where MAIN-world eval is blocked.
      const html = document.documentElement.outerHTML || "";
      const text = (document.body?.innerText || "").length;
      return {
        ok: true,
        stats: {
          htmlChars: html.length,
          nodes: document.getElementsByTagName("*").length,
          innerTextChars: text,
        },
      };
    }
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
