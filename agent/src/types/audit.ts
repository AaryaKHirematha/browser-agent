// ── Audit Types ──────────────────────────────────────────────────────────────
// Types for the audit and explainability system.

import type { TaskId } from "./core.js";
import type { RiskLevel } from "./risk.js";
import type { PolicyAction } from "./policy.js";
import type { ApprovalStatus } from "./approval.js";
import type { VerificationStatus } from "./verification.js";

/** Types of events the audit system records. */
export type AuditEventType =
  | "TASK_STARTED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_CANCELLED"
  | "OBSERVATION"
  | "ACTION_PROPOSED"
  | "ACTION_EXECUTED"
  | "ACTION_FAILED"
  | "RISK_ASSESSED"
  | "POLICY_EVALUATED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_RESOLVED"
  | "APPROVAL_EXPIRED"
  | "VERIFICATION_COMPLETED"
  | "RECOVERY_ATTEMPTED"
  | "RECOVERY_SUCCEEDED"
  | "RECOVERY_FAILED"
  | "SENSITIVE_DATA_DETECTED"
  | "SENSITIVE_DATA_REDACTED"
  | "SECURITY_EVENT"
  | "PROMPT_INJECTION_DETECTED"
  | "ERROR";

/** A single audit event. */
export interface AuditEvent {
  /** Auto-incremented event ID. */
  id: number;
  /** Timestamp of the event. */
  timestamp: number;
  /** Type of event. */
  type: AuditEventType;
  /** Associated task ID. */
  taskId?: TaskId;
  /** Domain where the event occurred. */
  domain?: string;
  /** URL where the event occurred. */
  url?: string;
  /** Description of the action or event. */
  action?: string;
  /** Target of the action (element description). */
  target?: string;
  /** Risk level if applicable. */
  riskLevel?: RiskLevel;
  /** Policy decision if applicable. */
  policyDecision?: PolicyAction;
  /** Approval status if applicable. */
  approvalStatus?: ApprovalStatus;
  /** Execution result if applicable. */
  result?: "SUCCESS" | "FAILURE" | "ERROR";
  /** Verification status if applicable. */
  verificationStatus?: VerificationStatus;
  /** Whether recovery was attempted. */
  recoveryAttempted?: boolean;
  /** Human-readable details (NEVER include sensitive data). */
  details?: string;
  /** Severity for security events. */
  severity?: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
}

/** Filter for querying audit events. */
export interface AuditFilter {
  taskId?: TaskId;
  types?: AuditEventType[];
  since?: number;
  until?: number;
  limit?: number;
  domain?: string;
}
