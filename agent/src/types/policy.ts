// ── Policy Types ─────────────────────────────────────────────────────────────
// Types for the policy engine.

import type { RiskLevel } from "./risk.js";
import type { ActionCategory } from "./action.js";

/** What the policy engine decides. */
export type PolicyAction = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

/** A policy decision for a particular action. */
export interface PolicyDecision {
  /** The action allowed/denied. */
  action: PolicyAction;
  /** Human-readable reason. */
  reason: string;
  /** The rule that produced this decision. */
  matchedRule?: string;
  /** Whether the decision was based on a default (no explicit rule). */
  isDefault: boolean;
  /** Timestamp of decision. */
  decidedAt: number;
}

/** A single rule in the policy configuration. */
export interface PolicyRule {
  /** Domain pattern (e.g. "github.com", "*.bank.com", "*"). */
  domain: string;
  /** Action category this rule applies to. */
  actionCategory: ActionCategory;
  /** Minimum risk level that triggers this rule (optional). */
  minRiskLevel?: RiskLevel;
  /** The policy action to take. */
  decision: PolicyAction;
  /** Human-readable description. */
  description?: string;
}

/** Domain-level policy configuration. */
export interface DomainPolicy {
  /** Domain pattern. */
  domain: string;
  /** Rules for this domain, keyed by action category. */
  rules: PolicyRule[];
  /** Whether this domain is trusted. */
  trusted: boolean;
}

/** Complete policy configuration. */
export interface PolicyConfig {
  /** Per-domain policies. */
  domains: DomainPolicy[];
  /** Default policy for unmatched domains. */
  defaultAction: PolicyAction;
  /** Global maximum risk level that is auto-allowed. */
  autoAllowMaxRisk: RiskLevel;
  /** Whether to require approval for unknown domains. */
  requireApprovalForUnknownDomains: boolean;
}
