// ── Verification Types ───────────────────────────────────────────────────────
// Types for the action verification engine.

/** Verification outcome status. */
export type VerificationStatus =
  | "VERIFIED_SUCCESS"
  | "VERIFIED_FAILURE"
  | "UNCERTAIN";

/** A signal used in verification. */
export interface VerificationSignal {
  /** Type of signal. */
  type: "URL_CHANGE" | "TITLE_CHANGE" | "DOM_CHANGE" | "GRAPH_DELTA" | "CONFIRMATION_MESSAGE" | "ELEMENT_STATE" | "ERROR_MESSAGE" | "EXPECTED_CONDITION";
  /** Whether this signal indicates success. */
  indicatesSuccess: boolean;
  /** Human-readable description. */
  description: string;
  /** Confidence in this signal (0-1). */
  confidence: number;
}

/** Complete verification result. */
export interface VerificationResult {
  /** Overall verification status. */
  status: VerificationStatus;
  /** Signals that contributed to the decision. */
  signals: VerificationSignal[];
  /** Combined confidence (0-1). */
  confidence: number;
  /** Human-readable summary. */
  summary: string;
  /** Timestamp of verification. */
  verifiedAt: number;
  /** Time taken to verify in ms. */
  latencyMs: number;
  /** What was expected. */
  expected?: string;
  /** What was observed. */
  observed?: string;
}
