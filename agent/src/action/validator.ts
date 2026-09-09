import type {
  ActionType,
  ActionProposal,
  ActionValidationResult,
} from "../types/action.js";

const SUPPORTED_ACTION_TYPES: Set<string> = new Set([
  "CLICK",
  "TYPE",
  "SCROLL",
  "SCROLL_TO",
  "NAVIGATE",
  "EVAL",
  "SELECT",
  "HIGHLIGHT",
  "CLEAR_HIGHLIGHT",
  "WAIT",
  "CUSTOM",
]);

const ALLOWED_URL_SCHEMES: Set<string> = new Set([
  "http:",
  "https:",
  "about:",
  "data:",
]);

const DANGEROUS_URL_SCHEMES: Set<string> = new Set([
  "file:",
  "chrome:",
  "javascript:",
  "vbscript:",
  "chrome-extension:",
]);

export class ActionValidator {
  /**
   * Deterministic local structural validation of an action proposal before Risk, Policy, and Approval pipeline processing.
   * NEVER modifies malicious/malformed actions silently. Fails closed on unknown types, invalid params, or exceptions.
   */
  validate(proposal: ActionProposal): ActionValidationResult {
    try {
      if (!proposal || typeof proposal !== "object") {
        return { allowed: false, reason: "Action proposal payload must be an object" };
      }

      if (!proposal.type || !SUPPORTED_ACTION_TYPES.has(proposal.type)) {
        return { allowed: false, reason: `Unknown or unsupported action type: ${String(proposal.type)}` };
      }

      const params = proposal.params ?? {};
      if (typeof params !== "object" || params === null) {
        return { allowed: false, reason: "Action parameters must be an object" };
      }

      switch (proposal.type) {
        case "NAVIGATE":
          return this.validateNavigate(params);
        case "CLICK":
          return this.validateClick(params);
        case "TYPE":
          return this.validateType(params);
        case "SCROLL":
          return this.validateScroll(params);
        case "SCROLL_TO":
          return this.validateScrollTo(params);
        case "EVAL":
          return this.validateEval(params);
        case "SELECT":
        case "HIGHLIGHT":
        case "CLEAR_HIGHLIGHT":
        case "WAIT":
        case "CUSTOM":
          return { allowed: true, sanitizedParams: params };
        default:
          return { allowed: false, reason: `Unrecognized action type: ${proposal.type}` };
      }
    } catch (err) {
      return {
        allowed: false,
        reason: `Action validation exception: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private validateNavigate(params: Record<string, unknown>): ActionValidationResult {
    const url = params.url;
    if (typeof url !== "string" || url.trim().length === 0) {
      return { allowed: false, reason: "Navigation requires a non-empty URL string parameter" };
    }

    try {
      const parsedUrl = new URL(url);
      if (DANGEROUS_URL_SCHEMES.has(parsedUrl.protocol.toLowerCase())) {
        return { allowed: false, reason: `Forbidden or dangerous URL scheme: ${parsedUrl.protocol}` };
      }
      if (!ALLOWED_URL_SCHEMES.has(parsedUrl.protocol.toLowerCase())) {
        return { allowed: false, reason: `Unsupported URL scheme: ${parsedUrl.protocol}` };
      }
      return { allowed: true, sanitizedParams: { ...params, url: parsedUrl.href } };
    } catch {
      return { allowed: false, reason: `Malformed URL format: ${url}` };
    }
  }

  private validateClick(params: Record<string, unknown>): ActionValidationResult {
    const index = params.index;
    if (index === undefined || index === null) {
      return { allowed: false, reason: "Click action requires a target element index" };
    }
    if (typeof index !== "number" || isNaN(index) || !isFinite(index) || !Number.isInteger(index) || index < 0) {
      return { allowed: false, reason: `Invalid target element index for click: ${String(index)}` };
    }
    return { allowed: true, sanitizedParams: params };
  }

  private validateType(params: Record<string, unknown>): ActionValidationResult {
    const index = params.index;
    const text = params.text;

    if (index === undefined || index === null) {
      return { allowed: false, reason: "Type action requires a target element index" };
    }
    if (typeof index !== "number" || isNaN(index) || !isFinite(index) || !Number.isInteger(index) || index < 0) {
      return { allowed: false, reason: `Invalid target element index for type: ${String(index)}` };
    }
    if (typeof text !== "string") {
      return { allowed: false, reason: "Type action requires a string text parameter" };
    }
    return { allowed: true, sanitizedParams: params };
  }

  private validateScroll(params: Record<string, unknown>): ActionValidationResult {
    const direction = params.direction;
    const amount = params.amount;

    if (direction !== undefined && typeof direction === "string") {
      if (!["up", "down", "top", "bottom"].includes(direction.toLowerCase())) {
        return { allowed: false, reason: `Invalid scroll direction: ${direction}` };
      }
    }

    if (amount !== undefined && amount !== null) {
      if (typeof amount !== "number" || isNaN(amount) || !isFinite(amount) || amount <= 0 || amount > 100000) {
        return { allowed: false, reason: `Invalid or extreme scroll amount: ${String(amount)}` };
      }
    }

    return { allowed: true, sanitizedParams: params };
  }

  private validateScrollTo(params: Record<string, unknown>): ActionValidationResult {
    const index = params.index;
    if (index === undefined || index === null) {
      return { allowed: false, reason: "Scroll_to action requires a target element index" };
    }
    if (typeof index !== "number" || isNaN(index) || !isFinite(index) || !Number.isInteger(index) || index < 0) {
      return { allowed: false, reason: `Invalid target element index for scroll_to: ${String(index)}` };
    }
    return { allowed: true, sanitizedParams: params };
  }

  private validateEval(params: Record<string, unknown>): ActionValidationResult {
    const expression = params.expression ?? params.script ?? params.code;
    if (typeof expression !== "string" || expression.trim().length === 0) {
      return { allowed: false, reason: "Eval action requires a non-empty expression string parameter" };
    }
    return {
      allowed: true,
      requiresEscalation: true,
      suggestedRiskLevel: "HIGH",
      sanitizedParams: params,
    };
  }
}
