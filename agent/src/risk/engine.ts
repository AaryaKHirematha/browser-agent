// ── Risk Engine ──────────────────────────────────────────────────────────────
// Classifies actions as LOW / MEDIUM / HIGH / CRITICAL based on action type,
// domain context, target element, reversibility, and sensitive data indicators.

import type { ActionProposal, ActionCategory } from "../types/action.js";
import type { RiskLevel, RiskAssessment, RiskFactor } from "../types/risk.js";

// ── Domain risk classification ──────────────────────────────────────────────

const HIGH_RISK_DOMAINS = [
  /bank/i, /pay/i, /finance/i, /wallet/i, /trade/i, /invest/i,
  /checkout/i, /billing/i, /stripe\.com/i, /paypal\.com/i,
  /venmo\.com/i, /wise\.com/i, /razorpay\.com/i,
];

const MEDIUM_RISK_DOMAINS = [
  /account/i, /admin/i, /settings/i, /security/i, /password/i,
  /auth/i, /login/i, /oauth/i, /console/i, /dashboard/i,
  /manage/i,
];

// ── Action text / context patterns ──────────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  /delete/i, /remove/i, /destroy/i, /erase/i, /drop/i, /purge/i,
  /revoke/i, /terminate/i, /deactivate/i, /disable/i, /cancel.*(?:account|subscription)/i,
  /unsubscribe/i, /close.*account/i,
];

const TRANSACTION_PATTERNS = [
  /pay/i, /purchase/i, /buy/i, /order/i, /checkout/i,
  /transfer/i, /send.*money/i, /subscribe/i, /confirm.*payment/i,
  /place.*order/i, /submit.*payment/i, /charge/i, /donate/i,
];

const CREDENTIAL_PATTERNS = [
  /password/i, /change.*email/i, /update.*phone/i, /two.?factor/i,
  /mfa/i, /2fa/i, /security.*key/i, /recovery.*code/i,
  /api.?key/i, /token/i, /secret/i, /credential/i,
];

const PUBLISH_PATTERNS = [
  /publish/i, /post/i, /tweet/i, /send.*email/i, /broadcast/i,
  /announce/i, /submit/i, /release/i, /deploy/i,
];

// ── Risk level ordering ─────────────────────────────────────────────────────

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function maxRisk(...levels: RiskLevel[]): RiskLevel {
  let max: RiskLevel = "LOW";
  for (const l of levels) {
    if (RISK_ORDER[l] > RISK_ORDER[max]) max = l;
  }
  return max;
}

// ── Category to base risk ───────────────────────────────────────────────────

const CATEGORY_RISK: Record<ActionCategory, RiskLevel> = {
  READ: "LOW",
  NAVIGATE: "LOW",
  WRITE: "MEDIUM",
  DELETE: "HIGH",
  TRANSACTION: "CRITICAL",
  ACCOUNT_CHANGE: "HIGH",
};

// ── Main Engine ─────────────────────────────────────────────────────────────

export class RiskEngine {
  assess(proposal: ActionProposal): RiskAssessment {
    const factors: RiskFactor[] = [];
    const t0 = Date.now();

    // Factor 1: Action category
    const categoryRisk = CATEGORY_RISK[proposal.category] ?? "MEDIUM";
    factors.push({
      category: "ACTION_TYPE",
      description: `Action category "${proposal.category}" has base risk ${categoryRisk}`,
      severity: categoryRisk,
      confidence: 0.9,
    });

    // Factor 2: Domain risk
    const domainRisk = this.assessDomain(proposal.domain);
    factors.push({
      category: "DOMAIN",
      description: `Domain "${proposal.domain}" classified as ${domainRisk} risk`,
      severity: domainRisk,
      confidence: 0.7,
    });

    // Factor 3: Target / description context
    const contextRisk = this.assessContext(proposal.description, proposal.params);
    if (contextRisk) factors.push(contextRisk);

    // Factor 4: Reversibility
    const reversible = this.isReversible(proposal);
    if (!reversible) {
      factors.push({
        category: "REVERSIBILITY",
        description: "Action appears irreversible",
        severity: "HIGH",
        confidence: 0.6,
      });
    }

    // Factor 5: Sensitive data involvement
    const dataRisk = this.assessDataSensitivity(proposal);
    if (dataRisk) factors.push(dataRisk);

    // Combine factors
    const overallLevel = maxRisk(...factors.map((f) => f.severity));
    const avgConfidence = factors.reduce((s, f) => s + f.confidence, 0) / factors.length;
    const approvalRequired = RISK_ORDER[overallLevel] >= RISK_ORDER["HIGH"];

    return {
      level: overallLevel,
      confidence: Math.round(avgConfidence * 100) / 100,
      factors,
      reason: factors
        .filter((f) => RISK_ORDER[f.severity] >= RISK_ORDER["MEDIUM"])
        .map((f) => f.description)
        .join("; ") || "No elevated risk factors",
      target: proposal.description,
      approvalRequired,
      reversible,
      assessedAt: t0,
    };
  }

  private assessDomain(domain: string): RiskLevel {
    if (HIGH_RISK_DOMAINS.some((p) => p.test(domain))) return "HIGH";
    if (MEDIUM_RISK_DOMAINS.some((p) => p.test(domain))) return "MEDIUM";
    return "LOW";
  }

  private assessContext(description: string, params: Record<string, unknown>): RiskFactor | null {
    const text = `${description} ${JSON.stringify(params)}`;

    if (TRANSACTION_PATTERNS.some((p) => p.test(text))) {
      return { category: "CONTEXT", description: "Transaction-related action detected", severity: "CRITICAL", confidence: 0.8 };
    }
    if (CREDENTIAL_PATTERNS.some((p) => p.test(text))) {
      return { category: "CONTEXT", description: "Credential/security change detected", severity: "HIGH", confidence: 0.8 };
    }
    if (DESTRUCTIVE_PATTERNS.some((p) => p.test(text))) {
      return { category: "CONTEXT", description: "Destructive action detected", severity: "HIGH", confidence: 0.8 };
    }
    if (PUBLISH_PATTERNS.some((p) => p.test(text))) {
      return { category: "CONTEXT", description: "Publishing/sending action detected", severity: "MEDIUM", confidence: 0.7 };
    }
    return null;
  }

  private isReversible(proposal: ActionProposal): boolean {
    if (proposal.category === "READ" || proposal.category === "NAVIGATE") return true;
    if (proposal.category === "DELETE" || proposal.category === "TRANSACTION") return false;
    if (proposal.category === "ACCOUNT_CHANGE") return false;
    // WRITE is generally reversible
    return true;
  }

  private assessDataSensitivity(proposal: ActionProposal): RiskFactor | null {
    const text = `${proposal.description} ${JSON.stringify(proposal.params)}`;
    if (/password|credit.?card|ssn|social.?security|cvv|secret|private.?key/i.test(text)) {
      return {
        category: "DATA",
        description: "Action involves sensitive data",
        severity: "HIGH",
        confidence: 0.75,
      };
    }
    return null;
  }
}
