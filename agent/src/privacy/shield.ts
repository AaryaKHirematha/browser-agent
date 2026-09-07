// ── Privacy Shield ───────────────────────────────────────────────────────────
// Detects and redacts sensitive data from observations before they reach
// the LLM. Field-level redaction preserves observation structure.

import type { SensitiveDataType, SensitiveDataDetection, RedactionResult } from "../types/privacy.js";

// ── Detection Patterns ──────────────────────────────────────────────────────

interface Pattern {
  type: SensitiveDataType;
  /** Regex to match the sensitive value. */
  regex: RegExp;
  /** Minimum confidence for this pattern. */
  confidence: number;
}

const PATTERNS: Pattern[] = [
  // Email addresses
  { type: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.8 },
  // Credit/debit card numbers (Luhn-like sequences)
  { type: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,19}\b/g, confidence: 0.7 },
  // CVV
  { type: "CVV", regex: /\b(?:cvv|cvc|cvv2|cvc2|security\s*code)\s*[:=]?\s*\d{3,4}\b/gi, confidence: 0.85 },
  // SSN
  { type: "SSN", regex: /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/g, confidence: 0.6 },
  // API keys (common formats)
  { type: "API_KEY", regex: /\b(?:sk|pk|api|key)[-_][a-zA-Z0-9_]{20,}\b/g, confidence: 0.8 },
  // Bearer tokens
  { type: "BEARER_TOKEN", regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, confidence: 0.9 },
  // Access tokens / session tokens (long hex/base64 strings in value context)
  { type: "ACCESS_TOKEN", regex: /(?:token|access_token|session|jwt)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{20,}["']?/gi, confidence: 0.8 },
  // Private keys
  { type: "PRIVATE_KEY", regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, confidence: 0.95 },
  // Passwords in common contexts
  { type: "PASSWORD", regex: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{4,}["']?/gi, confidence: 0.85 },
  // OTP codes
  { type: "OTP", regex: /(?:otp|one[- ]?time|verification|code)\s*[:=]?\s*\d{4,8}\b/gi, confidence: 0.75 },
  // Secret values
  { type: "SECRET", regex: /(?:secret|client_secret|app_secret)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi, confidence: 0.8 },
];

// Password-type input fields
const PASSWORD_FIELD_PATTERNS = [
  /type\s*[:=]\s*["']?password["']?/i,
  /password/i,
  /passwd/i,
  /secret/i,
];

const REDACTION_PLACEHOLDER = "[REDACTED]";

export class PrivacyShield {
  /** Scan text for sensitive data and return detections. Does NOT modify the text. */
  detect(text: string, location = "unknown"): SensitiveDataDetection[] {
    const detections: SensitiveDataDetection[] = [];
    for (const pattern of PATTERNS) {
      // Reset regex state for global patterns
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        detections.push({
          type: pattern.type,
          location,
          confidence: pattern.confidence,
          redacted: false,
        });
      }
    }
    return detections;
  }

  /** Redact sensitive data from text, replacing matches with [REDACTED]. */
  redact(text: string): { text: string; detections: SensitiveDataDetection[] } {
    const detections: SensitiveDataDetection[] = [];
    let redacted = text;

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(redacted)) {
        detections.push({
          type: pattern.type,
          location: "text",
          confidence: pattern.confidence,
          redacted: true,
        });
        pattern.regex.lastIndex = 0;
        redacted = redacted.replace(pattern.regex, REDACTION_PLACEHOLDER);
      }
    }

    return { text: redacted, detections };
  }

  /** Redact sensitive fields from a structured observation. */
  redactObservation(observation: Record<string, unknown>): RedactionResult {
    const allDetections: SensitiveDataDetection[] = [];
    let modified = false;

    const redactValue = (val: unknown, path: string): unknown => {
      if (typeof val === "string") {
        const { text, detections } = this.redact(val);
        if (detections.length > 0) {
          modified = true;
          for (const d of detections) {
            d.location = path;
            allDetections.push(d);
          }
          return text;
        }
        return val;
      }
      if (Array.isArray(val)) {
        return val.map((item, i) => redactValue(item, `${path}[${i}]`));
      }
      if (val && typeof val === "object") {
        const obj = val as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          // Redact password-type fields entirely
          if (PASSWORD_FIELD_PATTERNS.some((p) => p.test(k))) {
            if (typeof v === "string" && v.length > 0) {
              modified = true;
              allDetections.push({
                type: "PASSWORD",
                location: `${path}.${k}`,
                confidence: 0.9,
                redacted: true,
              });
              result[k] = REDACTION_PLACEHOLDER;
              continue;
            }
          }
          result[k] = redactValue(v, `${path}.${k}`);
        }
        return result;
      }
      return val;
    };

    const redactedObs = redactValue(observation, "observation") as Record<string, unknown>;
    // Mutate the original object in place
    for (const [k, v] of Object.entries(redactedObs)) {
      observation[k] = v;
    }

    return {
      detectionsCount: allDetections.length,
      detections: allDetections,
      modified,
    };
  }

  /** Check if a specific value looks like it contains sensitive data. */
  isSensitive(value: string): boolean {
    return this.detect(value).length > 0;
  }
}
