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
  | "PHONE";

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
