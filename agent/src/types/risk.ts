// ── Risk Types ───────────────────────────────────────────────────────────────
// Types for the risk assessment engine.

/** Risk severity level. */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** A factor contributing to the risk assessment. */
export interface RiskFactor {
  /** Factor category. */
  category: "ACTION_TYPE" | "DOMAIN" | "TARGET" | "CONTEXT" | "DATA" | "REVERSIBILITY";
  /** Human-readable description of this risk factor. */
  description: string;
  /** Contribution to overall risk level. */
  severity: RiskLevel;
  /** Confidence in this factor (0-1). */
  confidence: number;
}

/** Complete risk assessment for an action. */
export interface RiskAssessment {
  /** Overall risk level. */
  level: RiskLevel;
  /** Combined confidence (0-1). */
  confidence: number;
  /** Individual contributing factors. */
  factors: RiskFactor[];
  /** Human-readable summary. */
  reason: string;
  /** Description of the target element/page. */
  target: string;
  /** Whether human approval is recommended. */
  approvalRequired: boolean;
  /** Whether the action is reversible. */
  reversible: boolean;
  /** Timestamp of the assessment. */
  assessedAt: number;
}
