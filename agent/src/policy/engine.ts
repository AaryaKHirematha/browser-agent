// ── Policy Engine ────────────────────────────────────────────────────────────
// Evaluates domain + action + risk against configurable rules.
// Unknown actions default to safe behavior (REQUIRE_APPROVAL or DENY).

import type { ActionProposal } from "../types/action.js";
import type { RiskAssessment } from "../types/risk.js";
import type { PolicyConfig, PolicyDecision, PolicyAction, PolicyRule, DomainPolicy } from "../types/policy.js";

// ── Default Policy Configuration ────────────────────────────────────────────

const DEFAULT_CONFIG: PolicyConfig = {
  domains: [],
  defaultAction: "REQUIRE_APPROVAL",
  autoAllowMaxRisk: "MEDIUM",
  requireApprovalForUnknownDomains: true,
};

export class PolicyEngine {
  private config: PolicyConfig;

  constructor(config?: Partial<PolicyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.domains) this.config.domains = config.domains;
  }

  /** Evaluate an action proposal against the current policy. */
  evaluate(proposal: ActionProposal, risk: RiskAssessment): PolicyDecision {
    const t0 = Date.now();

    // 1. Find domain-specific rules
    const domainPolicy = this.findDomainPolicy(proposal.domain);

    // 2. Look for a matching rule
    if (domainPolicy) {
      const rule = this.findMatchingRule(domainPolicy, proposal, risk);
      if (rule) {
        return {
          action: rule.decision,
          reason: rule.description ?? `Rule: ${rule.actionCategory} on ${rule.domain} → ${rule.decision}`,
          matchedRule: `${rule.domain}:${rule.actionCategory}`,
          isDefault: false,
          decidedAt: t0,
        };
      }

      // Domain exists but no specific rule — use domain trust level
      if (domainPolicy.trusted && risk.level === "LOW") {
        return {
          action: "ALLOW",
          reason: `Trusted domain "${proposal.domain}" with LOW risk`,
          isDefault: false,
          decidedAt: t0,
        };
      }
    }

    // 3. Apply global defaults based on risk level
    const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    const autoAllowOrder = riskOrder[this.config.autoAllowMaxRisk];
    const proposalRiskOrder = riskOrder[risk.level];

    if (proposalRiskOrder <= autoAllowOrder) {
      return {
        action: "ALLOW",
        reason: `Risk level ${risk.level} is within auto-allow threshold (${this.config.autoAllowMaxRisk})`,
        isDefault: true,
        decidedAt: t0,
      };
    }

    // 4. HIGH/CRITICAL: require approval or deny
    if (risk.level === "CRITICAL") {
      // CRITICAL actions always need explicit approval
      return {
        action: "REQUIRE_APPROVAL",
        reason: `CRITICAL risk level always requires approval`,
        isDefault: true,
        decidedAt: t0,
      };
    }

    // HIGH risk
    return {
      action: this.config.defaultAction,
      reason: `No specific rule for "${proposal.category}" on "${proposal.domain}"; default policy: ${this.config.defaultAction}`,
      isDefault: true,
      decidedAt: t0,
    };
  }

  /** Get the current policy configuration. */
  getConfig(): PolicyConfig {
    return { ...this.config, domains: [...this.config.domains] };
  }

  /** Update the policy configuration at runtime. */
  updateConfig(patch: Partial<PolicyConfig>): void {
    if (patch.defaultAction != null) this.config.defaultAction = patch.defaultAction;
    if (patch.autoAllowMaxRisk != null) this.config.autoAllowMaxRisk = patch.autoAllowMaxRisk;
    if (patch.requireApprovalForUnknownDomains != null) {
      this.config.requireApprovalForUnknownDomains = patch.requireApprovalForUnknownDomains;
    }
  }

  /** Add or replace a domain policy. */
  setDomainPolicy(policy: DomainPolicy): void {
    const idx = this.config.domains.findIndex(
      (d) => d.domain.toLowerCase() === policy.domain.toLowerCase(),
    );
    if (idx >= 0) {
      this.config.domains[idx] = policy;
    } else {
      this.config.domains.push(policy);
    }
  }

  /** Remove a domain policy. */
  removeDomainPolicy(domain: string): boolean {
    const before = this.config.domains.length;
    this.config.domains = this.config.domains.filter(
      (d) => d.domain.toLowerCase() !== domain.toLowerCase(),
    );
    return this.config.domains.length < before;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private findDomainPolicy(domain: string): DomainPolicy | undefined {
    const lower = domain.toLowerCase();
    // Exact match first
    let found = this.config.domains.find((d) => d.domain.toLowerCase() === lower);
    if (found) return found;
    // Wildcard match (*.example.com)
    found = this.config.domains.find((d) => {
      if (!d.domain.startsWith("*.")) return false;
      const suffix = d.domain.slice(2).toLowerCase();
      return lower.endsWith(suffix);
    });
    return found;
  }

  private findMatchingRule(
    domainPolicy: DomainPolicy,
    proposal: ActionProposal,
    risk: RiskAssessment,
  ): PolicyRule | undefined {
    return domainPolicy.rules.find((rule) => {
      if (rule.actionCategory !== proposal.category) return false;
      if (rule.minRiskLevel) {
        const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
        if (riskOrder[risk.level] < riskOrder[rule.minRiskLevel]) return false;
      }
      return true;
    });
  }
}
