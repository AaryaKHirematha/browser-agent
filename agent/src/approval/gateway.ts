// ── Approval Gateway ─────────────────────────────────────────────────────────
// Manages human approval requests for high/critical risk actions.
// Requests have expiration. No implicit approval is ever granted.

import type { ApprovalRequest, ApprovalResponse, ApprovalStatus } from "../types/approval.js";
import type { RiskLevel } from "../types/risk.js";

/** Default approval timeout: 5 minutes. */
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

let nextId = 1;

export class ApprovalGateway {
  private requests = new Map<string, ApprovalRequest>();
  private expiryMs: number;

  constructor(expiryMs = DEFAULT_EXPIRY_MS) {
    this.expiryMs = expiryMs;
  }

  /** Create a new approval request. Returns the request object. */
  request(params: {
    action: string;
    target: string;
    domain: string;
    riskLevel: RiskLevel;
    reason: string;
    affectedData?: string;
  }): ApprovalRequest {
    const now = Date.now();
    const req: ApprovalRequest = {
      id: `apr_${nextId++}_${now}`,
      action: params.action,
      target: params.target,
      domain: params.domain,
      riskLevel: params.riskLevel,
      reason: params.reason,
      affectedData: params.affectedData,
      status: "PENDING",
      createdAt: now,
      expiresAt: now + this.expiryMs,
    };
    this.requests.set(req.id, req);
    return req;
  }

  /** Resolve a pending approval request. */
  resolve(response: ApprovalResponse): ApprovalRequest {
    const req = this.requests.get(response.requestId);
    if (!req) throw new Error(`No approval request found with ID: ${response.requestId}`);

    // Check expiration first
    if (req.status === "PENDING" && Date.now() > req.expiresAt) {
      req.status = "EXPIRED";
      req.resolvedAt = Date.now();
      return req;
    }

    if (req.status !== "PENDING") {
      throw new Error(`Approval request ${response.requestId} is already ${req.status}`);
    }

    req.status = response.decision === "APPROVED" ? "APPROVED" : "REJECTED";
    req.resolvedAt = Date.now();
    req.resolvedBy = response.reason ?? "user";
    return req;
  }

  /** Get a specific request by ID, expiring it if necessary. */
  get(id: string): ApprovalRequest | undefined {
    const req = this.requests.get(id);
    if (req && req.status === "PENDING" && Date.now() > req.expiresAt) {
      req.status = "EXPIRED";
      req.resolvedAt = Date.now();
    }
    return req;
  }

  /** Get all pending requests. Expires any that have timed out. */
  getPending(): ApprovalRequest[] {
    const now = Date.now();
    const pending: ApprovalRequest[] = [];
    for (const req of this.requests.values()) {
      if (req.status === "PENDING") {
        if (now > req.expiresAt) {
          req.status = "EXPIRED";
          req.resolvedAt = now;
        } else {
          pending.push(req);
        }
      }
    }
    return pending;
  }

  /** Get all requests (for audit purposes). */
  getAll(): ApprovalRequest[] {
    return Array.from(this.requests.values());
  }

  /** Check if a request is approved. */
  isApproved(id: string): boolean {
    return this.get(id)?.status === "APPROVED";
  }

  /** Check if a request is still pending. */
  isPending(id: string): boolean {
    return this.get(id)?.status === "PENDING";
  }

  /** Clear all resolved/expired requests (memory cleanup). */
  clearResolved(): number {
    let removed = 0;
    for (const [id, req] of this.requests) {
      if (req.status !== "PENDING") {
        this.requests.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
