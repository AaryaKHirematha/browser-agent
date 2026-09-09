// ── Recovery Engine ──────────────────────────────────────────────────────────
// Self-healing: when an action fails due to stale elements, page changes, or
// missing targets, re-observe and find the element by semantic matching.

import type { RecoveryResult, RecoveryStrategy, FailureClassification } from "../types/recovery.js";
import type { AgentErrorCode } from "../types/errors.js";
import type { Bridge } from "../bridge.js";

const MAX_RECOVERY_RETRIES = 3;

/** Classify a failure and suggest a recovery strategy. */
export function classifyFailure(error: Error): FailureClassification {
  const msg = error.message.toLowerCase();

  if (msg.includes("no element for index") || msg.includes("registry has")) {
    return {
      code: "ELEMENT_NOT_FOUND",
      recoverable: true,
      suggestedStrategy: "RE_OBSERVE",
      description: "Target element index not found in registry",
    };
  }
  if (msg.includes("detached") || msg.includes("stale")) {
    return {
      code: "STALE_ELEMENT",
      recoverable: true,
      suggestedStrategy: "SEMANTIC_MATCH",
      description: "Target element was detached from DOM",
    };
  }
  if (msg.includes("page changed") || msg.includes("navigation")) {
    return {
      code: "PAGE_CHANGED",
      recoverable: true,
      suggestedStrategy: "RE_OBSERVE",
      description: "Page changed since last observation",
    };
  }
  if (msg.includes("timed out") || msg.includes("timeout")) {
    return {
      code: "TIMEOUT",
      recoverable: true,
      suggestedStrategy: "WAIT_AND_RETRY",
      description: "Operation timed out",
    };
  }
  if (msg.includes("extension not connected")) {
    return {
      code: "EXTENSION_DISCONNECTED",
      recoverable: true,
      suggestedStrategy: "WAIT_AND_RETRY",
      description: "Extension disconnected — waiting for reconnection",
    };
  }

  return {
    code: "UNKNOWN",
    recoverable: false,
    suggestedStrategy: "ABORT",
    description: `Unclassified error: ${error.message}`,
  };
}

export class RecoveryEngine {
  constructor(private bridge?: Bridge) {}

  /** Attempt to recover from a failed action. */
  async recover(params: {
    error: Error;
    /** Description of the original target (role, text, attributes). */
    targetDescription?: string;
    /** The original element index that failed. */
    originalIndex?: number;
    /** The action type that was attempted. */
    actionType: string;
  }): Promise<RecoveryResult> {
    const t0 = Date.now();
    const classification = classifyFailure(params.error);

    if (!classification.recoverable) {
      return {
        recovered: false,
        strategy: "ABORT",
        failureReason: classification.description,
        confidence: 0,
        retryCount: 0,
        durationMs: Date.now() - t0,
        error: `Unrecoverable: ${classification.description}`,
      };
    }

    let strategy = classification.suggestedStrategy;
    let retryCount = 0;
    let newIndex: number | undefined;

    for (retryCount = 1; retryCount <= MAX_RECOVERY_RETRIES; retryCount++) {
      try {
        if (strategy === "WAIT_AND_RETRY") {
          // Wait for DOM to settle
          await this.wait(500 * retryCount);
          strategy = "RE_OBSERVE";
        }

        if (strategy === "RE_OBSERVE" || strategy === "SEMANTIC_MATCH") {
          if (!this.bridge || !this.bridge.connected) {
            strategy = "ABORT";
            break;
          }
          // Re-observe the page
          const state = await this.bridge.send({ type: "GET_STATE" }) as {
            elements?: Array<{
              index: number;
              role?: string;
              text?: string;
              tag?: string;
              attributes?: Record<string, string>;
            }>;
          };

          if (!state?.elements?.length) {
            strategy = "WAIT_AND_RETRY";
            continue;
          }

          // Try semantic matching if we have a target description
          if (params.targetDescription) {
            newIndex = this.semanticMatch(state.elements, params.targetDescription);
            if (newIndex != null) {
              return {
                recovered: true,
                strategy: "SEMANTIC_MATCH",
                oldTarget: params.originalIndex != null ? `#${params.originalIndex}` : undefined,
                newTarget: `#${newIndex}`,
                failureReason: classification.description,
                confidence: 0.7,
                retryCount,
                durationMs: Date.now() - t0,
              };
            }
          }

          // If no match found but we have elements, the page is at least loaded
          if (state.elements.length > 0) {
            return {
              recovered: true,
              strategy: "RE_OBSERVE",
              failureReason: classification.description,
              confidence: 0.5,
              retryCount,
              durationMs: Date.now() - t0,
            };
          }
        }

        if (strategy === "SCROLL_AND_FIND") {
          // Scroll down to find the target
          if (this.bridge && this.bridge.connected) {
            await this.bridge.send({ type: "SCROLL", direction: "down" });
            await this.wait(300);
          }
          strategy = "SEMANTIC_MATCH";
          continue;
        }
      } catch (retryError) {
        // Recovery attempt itself failed — try again with wait
        strategy = "WAIT_AND_RETRY";
      }
    }

    return {
      recovered: false,
      strategy,
      oldTarget: params.originalIndex != null ? `#${params.originalIndex}` : undefined,
      failureReason: classification.description,
      confidence: 0,
      retryCount,
      durationMs: Date.now() - t0,
      error: `Recovery failed after ${retryCount} attempts`,
    };
  }

  /** Semantic match: find the best-matching element by role, text, and attributes. */
  private semanticMatch(
    elements: Array<{
      index: number;
      role?: string;
      text?: string;
      tag?: string;
      attributes?: Record<string, string>;
    }>,
    targetDescription: string,
  ): number | undefined {
    const desc = targetDescription.toLowerCase();
    let bestScore = 0;
    let bestIndex: number | undefined;

    for (const el of elements) {
      let score = 0;
      const hay = [el.role, el.text, el.tag, ...Object.values(el.attributes || {})]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      // Split description into terms and score by term overlap
      const terms = desc.split(/\s+/).filter((t) => t.length > 2);
      for (const term of terms) {
        if (hay.includes(term)) score++;
      }

      // Bonus for role/text exact match
      if (el.role && desc.includes(el.role.toLowerCase())) score += 2;
      if (el.text && desc.includes(el.text.toLowerCase().slice(0, 30))) score += 3;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = el.index;
      }
    }

    // Only return if we have reasonable confidence
    return bestScore >= 2 ? bestIndex : undefined;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
