// Single source of truth for the browser tools. Both the JSON-RPC server and the
// MCP wrapper are generated from this list, so any agent — MCP-native or plain
// HTTP — sees exactly the same methods.
//
// `shape` is a Zod raw shape (what MCP's registerTool wants for inputSchema);
// the JSON-RPC server wraps it in z.object() for validation.
// `toCommand` maps validated params to the message the extension understands.

import { z } from "zod";

export interface Method {
  name: string;
  description: string;
  shape: Record<string, z.ZodTypeAny>;
  toCommand: (args: Record<string, any>) => Record<string, any>;
}

const tabId = z
  .number()
  .int()
  .optional()
  .describe("Target tab id. Defaults to the active tab.");

export const METHODS: Method[] = [
  {
    name: "browser_get_state",
    description:
      "Read the current page as JSON: url, title, viewport, scroll position, and every visible interactive element. Each element has an `index` used by the other tools. Call this first, and again after the page changes.",
    shape: { tabId },
    toCommand: () => ({ type: "GET_STATE" }),
  },
  {
    name: "browser_click",
    description:
      "Click the interactive element with the given index from the most recent browser_get_state.",
    shape: { index: z.number().int().describe("Element index from browser_get_state."), tabId },
    toCommand: (a) => ({ type: "CLICK", index: a.index }),
  },
  {
    name: "browser_type",
    description:
      "Type text into the editable element (input/textarea/contenteditable) with the given index. Set pressEnter to submit.",
    shape: {
      index: z.number().int().describe("Element index from browser_get_state."),
      text: z.string().describe("Text to type."),
      clear: z.boolean().optional().describe("Clear existing content first. Default true."),
      pressEnter: z.boolean().optional().describe("Press Enter after typing. Default false."),
      tabId,
    },
    toCommand: (a) => ({
      type: "TYPE",
      index: a.index,
      text: a.text,
      clear: a.clear,
      pressEnter: a.pressEnter,
    }),
  },
  {
    name: "browser_scroll",
    description: "Scroll the page up, down, to the top, or to the bottom.",
    shape: {
      direction: z.enum(["up", "down", "top", "bottom"]).optional().describe("Default down."),
      amount: z.number().optional().describe("Pixels for up/down. Default ~90% of viewport."),
      tabId,
    },
    toCommand: (a) => ({ type: "SCROLL", direction: a.direction, amount: a.amount }),
  },
  {
    name: "browser_scroll_to",
    description: "Scroll the element with the given index into view (centered).",
    shape: { index: z.number().int().describe("Element index from browser_get_state."), tabId },
    toCommand: (a) => ({ type: "SCROLL_TO", index: a.index }),
  },
  {
    name: "browser_navigate",
    description: "Navigate the target tab to a URL and wait for it to finish loading.",
    shape: { url: z.string().describe("Absolute URL to open."), tabId },
    toCommand: (a) => ({ type: "NAVIGATE", url: a.url }),
  },
  {
    name: "browser_highlight",
    description:
      "Draw numbered boxes over every indexed element (debug overlay). Refreshes the snapshot so indices match.",
    shape: { tabId },
    toCommand: () => ({ type: "HIGHLIGHT" }),
  },
  {
    name: "browser_clear_highlight",
    description: "Remove the debug overlay drawn by browser_highlight.",
    shape: { tabId },
    toCommand: () => ({ type: "CLEAR_HIGHLIGHT" }),
  },
];

export const METHOD_MAP = new Map(METHODS.map((m) => [m.name, m]));
