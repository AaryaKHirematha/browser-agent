// ── Privacy Types ────────────────────────────────────────────────────────────
// Types for the sensitive data protection shield.

/** Types of sensitive data the shield can detect. */
export type SensitiveDataType =
  | "PASSWORD"
  | "OTP"
  | "API_KEY"
  | "ACCESS_TOKEN"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "CVV"
  | "SSN"
  | "SECRET"
  | "PRIVATE_KEY"
  | "BEARER_TOKEN"
  | "SESSION_TOKEN"
  | "AUTH_COOKIE"
  | "EMAIL"
  | "PHONE"
  | "ACCOUNT_ID"
  | "BANK_IBAN"
  | "EMBEDDED_SECRET"
  | "ADDRESS"
  | "AUTH_TOKEN";

/** Configurable privacy firewall action for detected sensitive data. */
export type PrivacyPolicyDecision =
  | "REDACT"             // Replace with semantic placeholder e.g. [EMAIL_REDACTED]
  | "MASK"               // Mask partial string e.g. ****1234
  | "OMIT"               // Remove sensitive field entirely from context
  | "ALLOW"              // Keep original value (trusted internal use only)
  | "REQUIRE_APPROVAL";  // Stop and require human approval before exposing context

/** A detected sensitive data occurrence. */
export interface SensitiveDataDetection {
  /** Type of sensitive data found. */
  type: SensitiveDataType;
  /** Where it was found (field name, element description). */
  location: string;
  /** Confidence in the detection (0-1). */
  confidence: number;
  /** Whether the value was redacted. */
  redacted: boolean;
  /** Source of match (DOM text, input value, UI graph, or visual bounding box). */
  source?: "DOM_TEXT" | "INPUT_VALUE" | "GRAPH_NODE" | "VISUAL_BOUNDS";
  /** Semantic placeholder used for replacement (never original secret). */
  semanticPlaceholder?: string;
  /** Optional bounding box for visual screenshot masking. */
  boundingBox?: { x: number; y: number; width: number; height: number };
  /** Privacy firewall decision applied. */
  firewallDecision?: PrivacyPolicyDecision;
}

/** Result of running the privacy shield on an observation. */
export interface RedactionResult {
  /** How many sensitive values were detected. */
  detectionsCount: number;
  /** Individual detections. */
  detections: SensitiveDataDetection[];
  /** Whether the observation was modified. */
  modified: boolean;
}

/** Result returned by the Privacy Firewall evaluation pass. */
export interface PrivacyFirewallResult {
  /** Overall privacy status of the evaluated perception payload. */
  status: "PASS" | "REDACTION_REQUIRED" | "APPROVAL_REQUIRED" | "FAIL_CLOSED";
  /** Evaluated sensitive data detections with firewall decisions. */
  detections: SensitiveDataDetection[];
  /** Breakdown of findings by policy decision. */
  redactedCount: number;
  omittedCount: number;
  approvalRequiredCount: number;
  allowedCount: number;
  /** Whether privacy evaluation failed closed due to an error or unhandled sensitive context. */
  failClosed: boolean;
  /** Evaluation latency in ms. */
  latencyMs: number;
  /** Diagnostic log entries (strictly zero raw secrets). */
  diagnostics?: string[];
}


