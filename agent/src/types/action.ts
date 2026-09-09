// ── Action Types ─────────────────────────────────────────────────────────────
// Types for actions, proposals, and results.

import type { RiskAssessment } from "./risk.js";
import type { PolicyDecision } from "./policy.js";

/** The kind of browser action. */
export type ActionType =
  | "CLICK"
  | "TYPE"
  | "SCROLL"
  | "SCROLL_TO"
  | "NAVIGATE"
  | "EVAL"
  | "SELECT"
  | "HIGHLIGHT"
  | "CLEAR_HIGHLIGHT"
  | "WAIT"
  | "CUSTOM";

/** Semantic category of the action's effect. */
export type ActionCategory =
  | "READ"         // No side effects: scroll, observe, etc.
  | "NAVIGATE"     // Page navigation
  | "WRITE"        // Form fill, settings change, non-destructive mutation
  | "DELETE"       // Destructive content removal
  | "TRANSACTION"  // Financial or purchase action
  | "ACCOUNT_CHANGE"; // Password, email, profile, security change

/** An action the agent proposes to take. */
export interface ActionProposal {
  /** The browser-layer action type. */
  type: ActionType;
  /** Target element index (for click/type/scroll_to). */
  index?: number;
  /** Action parameters (text for TYPE, url for NAVIGATE, etc.). */
  params: Record<string, unknown>;
  /** Semantic description of what this action intends to do. */
  description: string;
  /** Semantic category. */
  category: ActionCategory;
  /** Domain of the current page. */
  domain: string;
  /** Risk assessment (filled in by risk engine). */
  risk?: RiskAssessment;
  /** Policy decision (filled in by policy engine). */
  policy?: PolicyDecision;
}

/** Result of executing an action. */
export interface ActionResult {
  ok: boolean;
  /** Error message if the action failed. */
  error?: string;
  /** The raw result from the browser layer. */
  rawResult?: unknown;
  /** Timestamp of execution. */
  executedAt: number;
  /** Duration of execution in ms. */
  durationMs: number;
}

/** Result of local action validation before execution. */
export interface ActionValidationResult {
  /** Whether the action passes local validation checks. */
  allowed: boolean;
  /** Reason if validation failed or flagged warnings. */
  reason?: string;
  /** List of validation warnings. */
  warnings?: string[];
  /** Sanitized/validated action parameters. */
  sanitizedParams?: Record<string, unknown>;
  /** Whether security warnings dictate escalating risk/requiring approval. */
  requiresEscalation?: boolean;
  /** Suggested risk level after validation. */
  suggestedRiskLevel?: string;
}

