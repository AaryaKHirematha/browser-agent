// ── Security: Prompt Injection Defense ────────────────────────────────────────
// Detects and flags potential prompt injection attempts in webpage content.
// Webpage content is UNTRUSTED DATA — it must never override system policy.

import type { SecurityEvent, InjectionPattern } from "../types/security.js";

// ── Injection Patterns ──────────────────────────────────────────────────────

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:system\s+)?instructions/i,
    description: "Instruction override attempt",
    severity: "CRITICAL",
  },
  {
    pattern: /you\s+(?:are|must)\s+(?:now|from now)\s+(?:a|an)/i,
    description: "Role reassignment attempt",
    severity: "CRITICAL",
  },
  {
    pattern: /(?:system|admin|root)\s*(?:prompt|instruction|command)\s*[:=]/i,
    description: "System prompt injection attempt",
    severity: "CRITICAL",
  },
  {
    pattern: /(?:send|transfer|wire|pay|donate)\s+(?:money|funds|bitcoin|crypto|eth|btc)\s+to/i,
    description: "Financial instruction injection",
    severity: "CRITICAL",
  },
  {
    pattern: /(?:download|install|execute|run)\s+(?:this|the)\s+(?:file|script|program|executable)/i,
    description: "Download/execute injection",
    severity: "CRITICAL",
  },
  {
    pattern: /(?:enter|type|input|fill)\s+(?:your|the)\s+(?:password|credentials|credit\s*card|ssn|social)/i,
    description: "Credential harvesting instruction",
    severity: "ERROR",
  },
  {
    pattern: /(?:forget|disregard|override|bypass)\s+(?:your|all|the)\s+(?:rules|policies|safety|security|restrictions)/i,
    description: "Policy bypass attempt",
    severity: "CRITICAL",
  },
  {
    pattern: /(?:do\s+not|don't)\s+(?:ask|require|wait\s+for)\s+(?:approval|permission|confirmation)/i,
    description: "Approval bypass attempt",
    severity: "ERROR",
  },
  {
    pattern: /(?:pretend|act\s+as\s+if|assume)\s+(?:you\s+(?:are|have)|this\s+is)\s+(?:authorized|approved|admin)/i,
    description: "Authorization spoofing attempt",
    severity: "ERROR",
  },
  {
    pattern: /(?:delete|remove|destroy|erase)\s+(?:all|every|the\s+entire)/i,
    description: "Mass destruction instruction",
    severity: "WARNING",
  },
  {
    pattern: /(?:click|press|tap)\s+(?:here|this|below)\s+(?:to\s+(?:claim|win|receive|verify))/i,
    description: "Clickbait/phishing instruction",
    severity: "WARNING",
  },
];

export class PromptInjectionDetector {
  /** Scan text for potential prompt injection patterns. */
  scan(text: string, source: string): SecurityEvent[] {
    const events: SecurityEvent[] = [];

    for (const pattern of INJECTION_PATTERNS) {
      pattern.pattern.lastIndex = 0;
      const match = pattern.pattern.exec(text);
      if (match) {
        events.push({
          type: "PROMPT_INJECTION",
          severity: pattern.severity,
          description: pattern.description,
          source,
          // Sanitize the matched text to avoid including actual malicious content
          triggeredBy: match[0].slice(0, 100),
          actionTaken: pattern.severity === "CRITICAL" ? "BLOCKED" : "FLAGGED",
          timestamp: Date.now(),
        });
      }
    }

    return events;
  }

  /** Scan an observation for injection attempts in element text/labels. */
  scanObservation(observation: {
    elements?: Array<{ text?: string; label?: string; attributes?: Record<string, string> }>;
    graphText?: string;
    page?: { url?: string; title?: string };
  }): SecurityEvent[] {
    const events: SecurityEvent[] = [];
    const source = observation.page?.url ?? "unknown";

    // Scan element text
    if (observation.elements) {
      for (const el of observation.elements) {
        if (el.text) events.push(...this.scan(el.text, source));
        if (el.label) events.push(...this.scan(el.label, source));
        if (el.attributes) {
          for (const v of Object.values(el.attributes)) {
            events.push(...this.scan(v, source));
          }
        }
      }
    }

    // Scan graph text
    if (observation.graphText) {
      events.push(...this.scan(observation.graphText, source));
    }

    // Scan title
    if (observation.page?.title) {
      events.push(...this.scan(observation.page.title, source));
    }

    // Deduplicate by description
    const seen = new Set<string>();
    return events.filter((e) => {
      const key = `${e.type}:${e.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Check if any CRITICAL injection was detected. */
  hasCriticalInjection(events: SecurityEvent[]): boolean {
    return events.some((e) => e.severity === "CRITICAL");
  }
}
