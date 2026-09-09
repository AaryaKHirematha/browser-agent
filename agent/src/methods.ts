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
    name: "browser_get_graph",
    description:
      "Read the page as a compact semantic UI tree (the agent's view — navigation/forms/products, not the raw DOM). Only interaction-useful nodes are kept; each interactive node has an `index` the action tools can target. Pass `query` to focus on a task (keeps matching interactive nodes + their context) or `roles` to filter (e.g. button, link). Kept live by a MutationObserver, so it reflects the current page.",
    shape: {
      query: z
        .string()
        .optional()
        .describe("Task hint; keeps interactive nodes whose name/role/text match all terms."),
      roles: z.array(z.string()).optional().describe('Restrict to these roles, e.g. ["button","link"].'),
      includeInvisible: z
        .boolean()
        .optional()
        .describe("Include off-screen/hidden interactive nodes too. Default false."),
      maxNodes: z.number().int().optional().describe("Max interactive nodes. Default 200."),
      tabId,
    },
    toCommand: (a) => ({
      type: "GET_GRAPH",
      query: a.query,
      roles: a.roles,
      includeInvisible: a.includeInvisible,
      maxNodes: a.maxNodes,
    }),
  },
  {
    name: "browser_graph_delta",
    description:
      "Return the mutations to the semantic UI graph since the last call (NODE_ADDED / NODE_REMOVED / NODE_CHANGED / EDGE_ADDED / EDGE_REMOVED). Use to track what changed after an action instead of re-reading the whole page. Draining resets the delta.",
    shape: { tabId },
    toCommand: () => ({ type: "GRAPH_DELTA" }),
  },
  {
    name: "browser_ui_graph",
    description:
      "Return the full raw semantic UI graph (all nodes + semantic edges) as a snapshot. Prefer browser_get_graph for acting; use this for debugging the graph itself.",
    shape: { tabId },
    toCommand: () => ({ type: "GET_UI_GRAPH" }),
  },
  {
    name: "browser_dom_stats",
    description:
      "Return raw-DOM size metrics for the page — { htmlChars, nodes, innerTextChars } — read from the content script's isolated world, so it works even on strict-CSP pages where browser_eval is blocked. Useful as a raw-HTML observation baseline.",
    shape: { tabId },
    toCommand: () => ({ type: "DOM_STATS" }),
  },
  {
    name: "browser_eval",
    description:
      "Evaluate a JavaScript expression in the page's MAIN world and return the JSON-serializable result. Runs in the page context, so it can read window globals set by the site (e.g. benchmark reward flags) and DOM properties the graph doesn't expose. Returns null for undefined; { __evalError } on a thrown error.",
    shape: {
      expression: z
        .string()
        .describe("A JS expression, e.g. \"document.title\" or \"WOB_REWARD_GLOBAL\"."),
      tabId,
    },
    toCommand: (a) => ({ type: "EVAL", expression: a.expression }),
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

  // ── Trustworthy Autonomous Browser Agent — New Tools ──────────────────────

  {
    name: "browser_screenshot",
    description:
      "Capture a screenshot of the visible area of the current tab. Returns a base64-encoded PNG. Useful for visual understanding and verification.",
    shape: { tabId },
    toCommand: () => ({ type: "SCREENSHOT" }),
  },
];

// ── Server-side tools (handled by the agent server, not the extension) ──────
// These are registered separately because they don't forward to the extension
// bridge — they use the agent's internal intelligence modules.

export interface ServerMethod {
  name: string;
  description: string;
  shape: Record<string, z.ZodTypeAny>;
}

export const SERVER_METHODS: ServerMethod[] = [
  {
    name: "browser_observe",
    description:
      "Intelligently observe the current page. Automatically selects the best observation mode (STATE/GRAPH/GRAPH_DELTA/VISUAL/HYBRID) based on the task, page complexity, and context. Returns a unified observation with elements, semantic context, and metadata. Pass 'task' to hint at what you're trying to do. Pass 'mode' to force a specific observation mode.",
    shape: {
      task: z.string().optional().describe("Task description to guide observation mode selection."),
      mode: z.enum(["STATE", "GRAPH", "GRAPH_DELTA", "VISUAL", "HYBRID"]).optional().describe("Force a specific observation mode."),
      query: z.string().optional().describe("Task query for graph filtering (used in GRAPH mode)."),
      maxNodes: z.number().int().optional().describe("Max interactive nodes (default 200)."),
      includeScreenshot: z.boolean().optional().describe("Include a screenshot in the observation."),
      tabId,
    },
  },
  {
    name: "browser_assess_action",
    description:
      "Assess the risk of a proposed browser action before executing it. Returns risk level (LOW/MEDIUM/HIGH/CRITICAL), contributing factors, whether approval is needed, and whether the action is reversible. Always call this before performing potentially dangerous actions.",
    shape: {
      action: z.string().describe("The action to assess (e.g. 'click', 'type', 'navigate')."),
      description: z.string().describe("What the action intends to do."),
      category: z.enum(["READ", "NAVIGATE", "WRITE", "DELETE", "TRANSACTION", "ACCOUNT_CHANGE"]).describe("Semantic category of the action."),
      domain: z.string().optional().describe("Domain where the action will be performed."),
      index: z.number().int().optional().describe("Target element index."),
    },
  },
  {
    name: "browser_request_approval",
    description:
      "Request human approval for a high-risk action. Returns an approval request with a unique ID. The action must not proceed until browser_resolve_approval is called with the request ID. Approval requests expire after 5 minutes.",
    shape: {
      action: z.string().describe("Description of the action requiring approval."),
      target: z.string().describe("What the action targets."),
      domain: z.string().describe("Domain of the current page."),
      riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).describe("Risk level of the action."),
      reason: z.string().describe("Why approval is needed."),
      affectedData: z.string().optional().describe("What data/elements are affected."),
    },
  },
  {
    name: "browser_resolve_approval",
    description:
      "Resolve a pending approval request. Pass the request ID from browser_request_approval and the decision (APPROVED or REJECTED).",
    shape: {
      requestId: z.string().describe("The approval request ID."),
      decision: z.enum(["APPROVED", "REJECTED"]).describe("The approval decision."),
      reason: z.string().optional().describe("Reason for the decision."),
    },
  },
  {
    name: "browser_verify_action",
    description:
      "Verify whether a recently executed action actually achieved its intended outcome. Checks URL changes, DOM mutations, graph delta, confirmation messages, and error indicators. Returns VERIFIED_SUCCESS, VERIFIED_FAILURE, or UNCERTAIN.",
    shape: {
      actionDescription: z.string().describe("What the action was supposed to do."),
      expectedCondition: z.string().optional().describe("What the expected outcome looks like."),
      tabId,
    },
  },
  {
    name: "browser_get_task_state",
    description:
      "Get the current task memory state: goal, known entities, action history, verification results, recovery history, and approval history.",
    shape: {
      taskId: z.string().optional().describe("Task ID. Uses the active task if not specified."),
    },
  },
  {
    name: "browser_get_audit",
    description:
      "Retrieve the audit log. Returns structured events with timestamps, actions, risk levels, policy decisions, verification results, and recovery attempts. Sensitive data is never included.",
    shape: {
      taskId: z.string().optional().describe("Filter by task ID."),
      types: z.array(z.string()).optional().describe("Filter by event types."),
      limit: z.number().int().optional().describe("Maximum events to return (default: 50)."),
      since: z.number().optional().describe("Only events after this timestamp (ms)."),
    },
  },
  {
    name: "browser_get_policy",
    description:
      "Get the current policy configuration: domain rules, default action, auto-allow risk threshold.",
    shape: {},
  },
  {
    name: "browser_set_policy",
    description:
      "Update the policy configuration. Set domain-specific rules for what actions are allowed, denied, or require approval.",
    shape: {
      domain: z.string().describe("Domain to configure (e.g. 'github.com')."),
      trusted: z.boolean().optional().describe("Whether to mark this domain as trusted."),
      rules: z.array(z.object({
        actionCategory: z.enum(["READ", "NAVIGATE", "WRITE", "DELETE", "TRANSACTION", "ACCOUNT_CHANGE"]),
        decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]),
        description: z.string().optional(),
      })).optional().describe("Rules for this domain."),
    },
  },
  {
    name: "browser_cancel_task",
    description: "Cancel the current task and stop autonomous execution.",
    shape: {
      taskId: z.string().describe("Task ID to cancel."),
      reason: z.string().optional().describe("Reason for cancellation."),
    },
  },
  {
    name: "browser_create_task",
    description: "Create a new task record with a goal and start URL.",
    shape: {
      goal: z.string().describe("The high level natural language goal for the task."),
      startUrl: z.string().optional().describe("Initial starting URL."),
    },
  },
  {
    name: "browser_run_task",
    description: "Step or run an autonomous task execution loop.",
    shape: {
      taskId: z.string().describe("Task ID to run."),
      actionProposal: z.object({
        type: z.enum(["CLICK", "TYPE", "NAVIGATE", "SCROLL", "EVAL"]),
        description: z.string(),
        category: z.enum(["READ", "NAVIGATE", "WRITE", "DELETE", "TRANSACTION", "ACCOUNT_CHANGE"]),
        domain: z.string(),
        params: z.record(z.any()).optional(),
      }).optional().describe("Proposed action for this step."),
    },
  },
  {
    name: "browser_get_task",
    description: "Get full execution status and state machine info for a task.",
    shape: {
      taskId: z.string().describe("Task ID to query."),
    },
  },
  {
    name: "browser_pause_task",
    description: "Pause an active task.",
    shape: {
      taskId: z.string().describe("Task ID to pause."),
    },
  },
  {
    name: "browser_resume_task",
    description: "Resume a paused task after approval or resolution.",
    shape: {
      taskId: z.string().describe("Task ID to resume."),
    },
  },
  {
    name: "browser_record_recovery",
    description: "Record a recovery attempt in the task memory.",
    shape: {
      taskId: z.string().optional().describe("Task ID. Uses the active task if not specified."),
    },
  },
  {
    name: "browser_run_llm_task",
    description:
      "Run an autonomous natural language browser task driven by a real or mock LLM agent. Observes current browser state, applies local visual perception, enforces pre-network privacy sanitization, scans for prompt injection, executes structured actions through the Trust & Safety action gate, and returns step-by-step progress and final answer.",
    shape: {
      prompt: z.string().describe("Natural language browser task prompt (e.g. 'Go to Wikipedia and find when Apollo 11 landed')."),
      maxSteps: z.number().int().optional().describe("Maximum allowed autonomous steps (default 10)."),
      tabId,
    },
  },
];

export const METHOD_MAP = new Map(METHODS.map((m) => [m.name, m]));
export const SERVER_METHOD_MAP = new Map(SERVER_METHODS.map((m) => [m.name, m]));
