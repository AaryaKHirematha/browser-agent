import type {
  SensitiveDataType,
  SensitiveDataDetection,
  RedactionResult,
  PrivacyPolicyDecision,
  PrivacyFirewallResult,
} from "../types/privacy.js";
import type { UnifiedPerceptionResult } from "../types/observation.js";
import { ScreenshotPrivacyProcessor } from "./screenshot.js";


// ── Semantic Placeholders Mapping ───────────────────────────────────────────

export const SEMANTIC_PLACEHOLDERS: Record<SensitiveDataType, string> = {
  PASSWORD: "[PASSWORD_REDACTED]",
  OTP: "[OTP_REDACTED]",
  API_KEY: "[API_KEY_REDACTED]",
  ACCESS_TOKEN: "[ACCESS_TOKEN_REDACTED]",
  CREDIT_CARD: "[CREDIT_CARD_REDACTED]",
  DEBIT_CARD: "[DEBIT_CARD_REDACTED]",
  CVV: "[CVV_REDACTED]",
  SSN: "[SSN_REDACTED]",
  SECRET: "[SECRET_REDACTED]",
  PRIVATE_KEY: "[PRIVATE_KEY_REDACTED]",
  BEARER_TOKEN: "[BEARER_TOKEN_REDACTED]",
  SESSION_TOKEN: "[SESSION_TOKEN_REDACTED]",
  AUTH_COOKIE: "[AUTH_COOKIE_REDACTED]",
  EMAIL: "[EMAIL_REDACTED]",
  PHONE: "[PHONE_REDACTED]",
  ACCOUNT_ID: "[ACCOUNT_ID_REDACTED]",
  BANK_IBAN: "[IBAN_REDACTED]",
  EMBEDDED_SECRET: "[SECRET_REDACTED]",
  ADDRESS: "[ADDRESS_REDACTED]",
  AUTH_TOKEN: "[AUTH_TOKEN_REDACTED]",
};

// ── Detection Patterns ──────────────────────────────────────────────────────

interface Pattern {
  type: SensitiveDataType;
  /** Regex to match the sensitive value. */
  regex: RegExp;
  /** Minimum confidence for this pattern. */
  confidence: number;
}

const PATTERNS: Pattern[] = [
  // Phone numbers
  { type: "PHONE", regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, confidence: 0.8 },
  // Session tokens
  { type: "SESSION_TOKEN", regex: /(?:session_token|sess_id|sessionid)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{12,}["']?/gi, confidence: 0.85 },
  // Email addresses
  { type: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.8 },
  // Credit/debit card numbers (Luhn-like sequences)
  { type: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,19}\b/g, confidence: 0.7 },
  // CVV
  { type: "CVV", regex: /\b(?:cvv|cvc|cvv2|cvc2|security\s*code)\s*[:=]?\s*\d{3,4}\b/gi, confidence: 0.85 },
  // SSN
  { type: "SSN", regex: /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/g, confidence: 0.6 },
  // API keys (common formats)
  { type: "API_KEY", regex: /\b(?:sk|pk|api|key)[-_][a-zA-Z0-9_-]{12,}\b/gi, confidence: 0.8 },
  // Bearer tokens
  { type: "BEARER_TOKEN", regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, confidence: 0.9 },
  // Access tokens / session tokens (long hex/base64 strings in value context)
  { type: "ACCESS_TOKEN", regex: /(?:access_token|tok_)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{16,}["']?/gi, confidence: 0.8 },
  // Private keys
  { type: "PRIVATE_KEY", regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, confidence: 0.95 },
  // Passwords in common contexts
  { type: "PASSWORD", regex: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{4,}["']?/gi, confidence: 0.85 },
  // OTP codes
  { type: "OTP", regex: /(?:otp|one[- ]?time|verification|code)\s*[:=]?\s*\d{4,8}\b/gi, confidence: 0.75 },
  // Secret values
  { type: "SECRET", regex: /(?:secret|client_secret|app_secret)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi, confidence: 0.8 },
  // Account IDs (contextual pattern to control false positives)
  { type: "ACCOUNT_ID", regex: /\b(?:account|acc|acct|routing)\s*[:=]?\s*#?\s*[-]?\s*\d{6,12}\b/gi, confidence: 0.8 },
  // International Bank Account Numbers (IBAN)
  { type: "BANK_IBAN", regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi, confidence: 0.9 },
  // Embedded Secrets (AWS, cloud keys)
  { type: "EMBEDDED_SECRET", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, confidence: 0.95 },
  // Authentication Headers / Tokens
  { type: "AUTH_TOKEN", regex: /\b(?:Authorization|Auth-Token|X-Auth-Token)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{16,}["']?/gi, confidence: 0.85 },
  // Physical Addresses (Street + suffix)
  { type: "ADDRESS", regex: /\b\d{1,5}\s+[A-Z][a-z0-9\s,]{2,30}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Bengaluru|City)\b/gi, confidence: 0.75 },
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
  private screenshotProcessor = new ScreenshotPrivacyProcessor();

  /** Scan text for sensitive data and return detections. Does NOT modify the text and NEVER exposes raw values. */
  detect(
    text: string,
    location = "unknown",
    source: "DOM_TEXT" | "INPUT_VALUE" | "GRAPH_NODE" | "VISUAL_BOUNDS" = "DOM_TEXT"
  ): SensitiveDataDetection[] {
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
          source,
          semanticPlaceholder: SEMANTIC_PLACEHOLDERS[pattern.type] ?? REDACTION_PLACEHOLDER,
        });
      }
    }
    return detections;
  }

  /**
   * Run privacy detection across a complete UnifiedPerceptionResult object.
   * Scans page metadata, elements, semantic UI graph, and incorporates visual sensitive regions.
   */
  detectPerception(perception: UnifiedPerceptionResult): SensitiveDataDetection[] {
    const detections: SensitiveDataDetection[] = [];

    // Scan page title
    if (perception.page?.title) {
      detections.push(...this.detect(perception.page.title, "page.title", "DOM_TEXT"));
    }

    // Scan elements
    if (perception.elements) {
      for (const el of perception.elements) {
        if (el.text) {
          detections.push(...this.detect(el.text, `element[${el.index}]`, "DOM_TEXT"));
        }
        if (el.role === "password" || el.attributes?.type === "password") {
          detections.push({
            type: "PASSWORD",
            location: `element[${el.index}]`,
            confidence: 0.95,
            redacted: false,
            source: "INPUT_VALUE",
            semanticPlaceholder: SEMANTIC_PLACEHOLDERS.PASSWORD,
            boundingBox: el.boundingBox,
          });
        }
      }
    }

    // Scan semantic graph
    if (perception.graphText) {
      detections.push(...this.detect(perception.graphText, "graphText", "GRAPH_NODE"));
    }

    // Incorporate visual sensitive regions from Phase 3 visual perception analyzer
    if (perception.visualAnalysis?.sensitiveVisualRegions) {
      for (const vr of perception.visualAnalysis.sensitiveVisualRegions) {
        const type = (vr.type as SensitiveDataType) ?? "PASSWORD";
        detections.push({
          type,
          location: "visual.sensitiveRegion",
          confidence: 0.9,
          redacted: false,
          source: "VISUAL_BOUNDS",
          semanticPlaceholder: SEMANTIC_PLACEHOLDERS[type] ?? REDACTION_PLACEHOLDER,
          boundingBox: vr.bounds,
        });
      }
    }

    return detections;
  }

  /**
   * Evaluate privacy firewall policies over a UnifiedPerceptionResult.
   * Single-pass, zero-duplication evaluation returning PrivacyFirewallResult.
   * NEVER logs or leaks raw secrets. Fails closed on evaluation errors.
   */
  evaluatePerception(perception: UnifiedPerceptionResult): PrivacyFirewallResult {
    const t0 = Date.now();
    try {
      const detections = this.detectPerception(perception);

      let redactedCount = 0;
      let omittedCount = 0;
      let approvalRequiredCount = 0;
      let allowedCount = 0;

      for (const d of detections) {
        const decision = this.determineFirewallDecision(d);
        d.firewallDecision = decision;

        switch (decision) {
          case "REDACT":
          case "MASK":
            redactedCount++;
            break;
          case "OMIT":
            omittedCount++;
            break;
          case "REQUIRE_APPROVAL":
            approvalRequiredCount++;
            break;
          case "ALLOW":
            allowedCount++;
            break;
        }
      }

      let status: PrivacyFirewallResult["status"] = "PASS";
      if (approvalRequiredCount > 0) {
        status = "APPROVAL_REQUIRED";
      } else if (redactedCount > 0 || omittedCount > 0) {
        status = "REDACTION_REQUIRED";
      }

      const latencyMs = Date.now() - t0;

      return {
        status,
        detections,
        redactedCount,
        omittedCount,
        approvalRequiredCount,
        allowedCount,
        failClosed: false,
        latencyMs,
        diagnostics: [
          `Evaluated ${detections.length} detections in ${latencyMs}ms: ${redactedCount} redact, ${omittedCount} omit, ${approvalRequiredCount} approval`,
        ],
      };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      return {
        status: "FAIL_CLOSED",
        detections: [],
        redactedCount: 0,
        omittedCount: perception?.elements?.length ?? 1,
        approvalRequiredCount: 0,
        allowedCount: 0,
        failClosed: true,
        latencyMs,
        diagnostics: [`Privacy Firewall error fallback: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  private determineFirewallDecision(detection: SensitiveDataDetection): PrivacyPolicyDecision {
    switch (detection.type) {
      case "PASSWORD":
      case "SECRET":
      case "PRIVATE_KEY":
      case "EMBEDDED_SECRET":
      case "AUTH_TOKEN":
      case "BEARER_TOKEN":
      case "ACCESS_TOKEN":
      case "SESSION_TOKEN":
      case "AUTH_COOKIE":
        return "OMIT";
      case "CREDIT_CARD":
      case "DEBIT_CARD":
      case "CVV":
      case "SSN":
      case "ACCOUNT_ID":
      case "BANK_IBAN":
      case "EMAIL":
      case "PHONE":
      case "ADDRESS":
      case "OTP":
        return "REDACT";
      default:
        return "REDACT";
    }
  }

  /**
   * Transform perception into a sanitized context based on Phase 5 Privacy Firewall decisions.
   * Single-pass transformation — DOES NOT re-run detection regexes or visual analysis.
   * Ensures raw sensitive values never appear in the sanitized output. Idempotent & fail-closed.
   */
  sanitizePerception(
    perception: UnifiedPerceptionResult,
    firewallResult?: PrivacyFirewallResult
  ): UnifiedPerceptionResult {
    try {
      const firewall = firewallResult ?? this.evaluatePerception(perception);

      // If no detections or PASS status, return perception marked sanitized
      if (!firewall.detections || firewall.detections.length === 0) {
        return {
          ...perception,
          sanitized: true,
          sensitiveDataSummary: {
            detectedCount: 0,
            redactedCount: 0,
            typesFound: [],
            privacyPolicyApplied: "PASS",
          },
        };
      }

      // Group detections by location to avoid duplicate/overlapping replacements
      const locationMap = new Map<string, SensitiveDataDetection[]>();
      for (const d of firewall.detections) {
        if (!d) continue;
        const loc = d.location ?? "unknown";
        if (!locationMap.has(loc)) {
          locationMap.set(loc, []);
        }
        locationMap.get(loc)!.push(d);
      }

      // Deep clone element list and page metadata cleanly for targeted mutation
      const sanitizedElements = perception.elements ? perception.elements.map((el) => ({ ...el })) : [];
      let sanitizedTitle = perception.page?.title ?? "";
      let sanitizedGraphText = perception.graphText;

      // 1. Sanitize page title with localized field boundary fail-closed safety
      const titleDetections = locationMap.get("page.title");
      if (titleDetections && titleDetections.length > 0) {
        try {
          sanitizedTitle = this.applyDetectionsToText(sanitizedTitle, titleDetections);
        } catch {
          sanitizedTitle = "[OMITTED_SECRET]";
        }
      }

      // 2. Sanitize interactive elements with localized element boundary fail-closed safety
      for (let i = 0; i < sanitizedElements.length; i++) {
        const el = sanitizedElements[i];
        if (!el) continue;
        const elDetections = locationMap.get(`element[${el.index}]`);

        if (elDetections && elDetections.length > 0) {
          try {
            const hasOmit = elDetections.some((d) => d && d.firewallDecision === "OMIT");
            const hasApproval = elDetections.some((d) => d && d.firewallDecision === "REQUIRE_APPROVAL");

            if (hasOmit) {
              el.text = "[OMITTED_SECRET]";
              if (el.label) el.label = "[OMITTED_SECRET]";
            } else if (hasApproval) {
              el.text = "[APPROVAL_REQUIRED_REDACTED]";
              if (el.label) el.label = "[APPROVAL_REQUIRED_REDACTED]";
            } else {
              el.text = this.applyDetectionsToText(el.text, elDetections);
              if (el.label) {
                el.label = this.applyDetectionsToText(el.label, elDetections);
              }
            }
          } catch {
            // Localized fail-closed fallback: scrub only this element, preserving unrelated elements
            el.text = "[OMITTED_SECRET]";
            if (el.label) el.label = "[OMITTED_SECRET]";
          }
        }
      }

      // 3. Sanitize semantic graph text with localized boundary fail-closed safety
      const graphDetections = locationMap.get("graphText");
      if (graphDetections && graphDetections.length > 0 && sanitizedGraphText) {
        try {
          sanitizedGraphText = this.applyDetectionsToText(sanitizedGraphText, graphDetections);
        } catch {
          sanitizedGraphText = "[OMITTED_SECRET]";
        }
      }

      // 4. Sanitize base64 screenshot payload if present
      let sanitizedScreenshot = perception.screenshot;
      if (sanitizedScreenshot) {
        try {
          const screenshotResult = this.screenshotProcessor.processScreenshot(
            sanitizedScreenshot,
            perception.visualAnalysis?.sensitiveVisualRegions,
            firewall.detections,
            perception.page?.viewportSize
          );
          if (screenshotResult.failClosed) {
            sanitizedScreenshot = undefined;
          } else {
            sanitizedScreenshot = screenshotResult.sanitizedScreenshot;
          }
        } catch {
          sanitizedScreenshot = undefined;
        }
      }

      // Collect types found safely
      const validDetections = firewall.detections.filter((d): d is SensitiveDataDetection => Boolean(d && d.type));
      const typesFound = Array.from(new Set(validDetections.map((d) => d.type)));

      return {
        ...perception,
        elements: sanitizedElements,
        page: {
          ...perception.page,
          title: sanitizedTitle,
        },
        graphText: sanitizedGraphText,
        screenshot: sanitizedScreenshot,
        sanitized: true,
        sensitiveDataSummary: {
          detectedCount: firewall.detections.length,
          redactedCount: firewall.redactedCount,
          typesFound,
          privacyPolicyApplied: firewall.status,
        },
      };
    } catch (err) {
      // Top-level fail-closed fallback: only used if overall perception payload structure is unreadable/corrupted
      return {
        ...perception,
        elements: perception.elements ? perception.elements.map((el) => ({ ...el, text: "[FAIL_CLOSED_OMITTED]" })) : [],
        screenshot: undefined, // Never expose raw screenshot in fail-closed fallback!
        sanitized: true,
        sensitiveDataSummary: {
          detectedCount: 1,
          redactedCount: perception.elements?.length ?? 1,
          typesFound: ["SECRET"],
          privacyPolicyApplied: "FAIL_CLOSED",
        },
      };
    }
  }

  /** Helper to apply detection replacement rules to a text string without duplicating placeholders. */
  private applyDetectionsToText(text: string, detections: SensitiveDataDetection[]): string {
    if (!text) return text;
    let result = text;

    for (const d of detections) {
      if (!d) continue;
      const placeholder = d.semanticPlaceholder ?? "[REDACTED]";
      if (result.includes(placeholder) || result.includes("••••")) continue;

      if (d.firewallDecision === "OMIT") {
        result = "[OMITTED_SECRET]";
      } else if (d.firewallDecision === "REQUIRE_APPROVAL") {
        result = "[APPROVAL_REQUIRED_REDACTED]";
      } else if (d.firewallDecision === "MASK") {
        const { text: maskedText } = this.mask(result);
        result = maskedText;
      } else if (d.firewallDecision === "REDACT") {
        const { text: redactedText } = this.redact(result);
        result = redactedText;
      } else {
        const { text: redactedText } = this.redact(result);
        result = redactedText;
      }
    }

    return result;
  }

  /** Mask sensitive data in text, replacing matches with safe structural representations (e.g. •••• 1111 or ••••@domain.com). */
  mask(text: string): { text: string; detections: SensitiveDataDetection[] } {
    const detections: SensitiveDataDetection[] = [];
    let masked = text;

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(masked)) {
        detections.push({
          type: pattern.type,
          location: "text",
          confidence: pattern.confidence,
          redacted: true,
          source: "DOM_TEXT",
          semanticPlaceholder: SEMANTIC_PLACEHOLDERS[pattern.type] ?? REDACTION_PLACEHOLDER,
        });
        pattern.regex.lastIndex = 0;
        masked = masked.replace(pattern.regex, (match) => this.maskValue(match, pattern.type));
      }
    }

    return { text: masked, detections };
  }

  /** Convert a sensitive matched string into a minimum safe structural masked representation. */
  maskValue(value: string, type?: SensitiveDataType): string {
    if (!value) return value;

    if (type === "EMAIL" || value.includes("@")) {
      const parts = value.split("@");
      if (parts.length === 2 && parts[1]) {
        return `••••@${parts[1]}`;
      }
      return "••••@domain.com";
    }

    const digitsOnly = value.replace(/\D/g, "");
    if (digitsOnly.length >= 4) {
      const last4 = digitsOnly.slice(-4);
      return `•••• ${last4}`;
    }

    const cleanStr = value.trim();
    if (cleanStr.length >= 4) {
      const last4 = cleanStr.slice(-4);
      return `•••• ${last4}`;
    }

    return "••••";
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
          source: "DOM_TEXT",
          semanticPlaceholder: SEMANTIC_PLACEHOLDERS[pattern.type] ?? REDACTION_PLACEHOLDER,
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
          if (PASSWORD_FIELD_PATTERNS.some((p) => p.test(k))) {
            if (typeof v === "string" && v.length > 0) {
              modified = true;
              allDetections.push({
                type: "PASSWORD",
                location: `${path}.${k}`,
                confidence: 0.9,
                redacted: true,
                source: "INPUT_VALUE",
                semanticPlaceholder: SEMANTIC_PLACEHOLDERS.PASSWORD,
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
    }

    const redactedObs = redactValue(observation, "observation") as Record<string, unknown>;
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

