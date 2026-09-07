// ── Recovery Types ───────────────────────────────────────────────────────────
// Types for the self-healing recovery engine.

/** Recovery strategy the engine can attempt. */
export type RecoveryStrategy =
  | "RE_OBSERVE"         // Take a fresh observation
  | "SEMANTIC_MATCH"     // Find element by role/text/attributes
  | "VISUAL_MATCH"       // Find element by visual position (future)
  | "SCROLL_AND_FIND"    // Scroll to find the target
  | "WAIT_AND_RETRY"     // Wait for DOM to settle, then retry
  | "NAVIGATE_BACK"      // Go back if navigation was unexpected
  | "REFRESH_PAGE"       // Reload the page (last resort)
  | "ABORT";             // Give up

/** Classification of the failure that triggered recovery. */
export interface FailureClassification {
  /** Error code from the standardized error framework. */
  code: string;
  /** Whether recovery is possible. */
  recoverable: boolean;
  /** Suggested strategy. */
  suggestedStrategy: RecoveryStrategy;
  /** Human-readable description. */
  description: string;
}

/** Result of a recovery attempt. */
export interface RecoveryResult {
  /** Whether recovery succeeded. */
  recovered: boolean;
  /** Strategy that was used. */
  strategy: RecoveryStrategy;
  /** The original target (e.g. element index). */
  oldTarget?: string;
  /** The new target after recovery (e.g. new element index). */
  newTarget?: string;
  /** Why recovery was needed. */
  failureReason: string;
  /** How confident we are in the new target (0-1). */
  confidence: number;
  /** Number of retries attempted. */
  retryCount: number;
  /** Total time spent on recovery in ms. */
  durationMs: number;
  /** Error message if recovery failed. */
  error?: string;
}
