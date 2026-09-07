// ── Security Types ───────────────────────────────────────────────────────────
// Types for security hardening and prompt injection defense.

/** Trust level in the information hierarchy. */
export type TrustLevel =
  | "SYSTEM"    // Internal system instructions — highest trust
  | "POLICY"    // Configured policies — high trust
  | "USER"      // User-provided goals — trusted
  | "AGENT"     // Agent reasoning — moderate trust
  | "WEBPAGE";  // Webpage content — UNTRUSTED

/** A detected security event. */
export interface SecurityEvent {
  /** Type of security event. */
  type: "PROMPT_INJECTION" | "SUSPICIOUS_CONTENT" | "POLICY_BYPASS_ATTEMPT" | "UNAUTHORIZED_ACTION" | "SENSITIVE_DATA_EXPOSURE" | "EVAL_ABUSE";
  /** Severity of the event. */
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  /** Human-readable description. */
  description: string;
  /** Source of the threat (URL, element, etc.). */
  source: string;
  /** Content that triggered the event (sanitized — no secrets). */
  triggeredBy?: string;
  /** Action taken in response. */
  actionTaken: "BLOCKED" | "FLAGGED" | "ALLOWED_WITH_WARNING" | "LOGGED";
  /** Timestamp. */
  timestamp: number;
}

/** Patterns that suggest prompt injection in webpage content. */
export interface InjectionPattern {
  /** Regex pattern to match. */
  pattern: RegExp;
  /** Description of what this pattern detects. */
  description: string;
  /** Severity if matched. */
  severity: "WARNING" | "ERROR" | "CRITICAL";
}
