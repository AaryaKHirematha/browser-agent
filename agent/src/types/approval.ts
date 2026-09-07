// ── Approval Types ───────────────────────────────────────────────────────────
// Types for the human approval gateway.

import type { RiskLevel } from "./risk.js";

/** Status of an approval request. */
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

/** A request for human approval. */
export interface ApprovalRequest {
  /** Unique approval request ID. */
  id: string;
  /** Description of the action requiring approval. */
  action: string;
  /** Target element or page description. */
  target: string;
  /** Domain of the current page. */
  domain: string;
  /** Risk level of the action. */
  riskLevel: RiskLevel;
  /** Why approval is needed. */
  reason: string;
  /** What data/elements are affected. */
  affectedData?: string;
  /** Current status. */
  status: ApprovalStatus;
  /** When the request was created. */
  createdAt: number;
  /** When the request expires (auto-reject). */
  expiresAt: number;
  /** When the request was resolved (approved/rejected). */
  resolvedAt?: number;
  /** Who/what resolved it. */
  resolvedBy?: string;
}

/** Response to an approval request. */
export interface ApprovalResponse {
  /** The request ID being responded to. */
  requestId: string;
  /** The decision. */
  decision: "APPROVED" | "REJECTED";
  /** Optional reason for the decision. */
  reason?: string;
}
