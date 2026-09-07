// ── Verification Engine ──────────────────────────────────────────────────────
// Post-action verification: observe → verify → report.
// Uses multiple signals to determine whether an action actually succeeded.

import type { VerificationResult, VerificationSignal, VerificationStatus } from "../types/verification.js";
import type { Bridge } from "../bridge.js";

/** Snapshot of page state used for before/after comparison. */
export interface PageSnapshot {
  url: string;
  title: string;
  elementCount: number;
  timestamp: number;
}

export class VerificationEngine {
  constructor(private bridge: Bridge) {}

  /** Take a lightweight page snapshot for comparison. */
  async snapshot(): Promise<PageSnapshot> {
    try {
      const state = await this.bridge.send({ type: "GET_STATE" }) as {
        url?: string;
        title?: string;
        elements?: unknown[];
      };
      return {
        url: state?.url ?? "",
        title: state?.title ?? "",
        elementCount: state?.elements?.length ?? 0,
        timestamp: Date.now(),
      };
    } catch {
      return { url: "", title: "", elementCount: 0, timestamp: Date.now() };
    }
  }

  /** Verify an action by comparing before/after state. */
  async verify(params: {
    actionDescription: string;
    beforeSnapshot: PageSnapshot;
    expectedCondition?: string;
  }): Promise<VerificationResult> {
    const t0 = Date.now();
    const signals: VerificationSignal[] = [];

    // Take post-action snapshot
    const after = await this.snapshot();

    // Signal 1: URL change
    if (after.url !== params.beforeSnapshot.url) {
      signals.push({
        type: "URL_CHANGE",
        indicatesSuccess: true,
        description: `URL changed: ${params.beforeSnapshot.url} → ${after.url}`,
        confidence: 0.7,
      });
    }

    // Signal 2: Title change
    if (after.title !== params.beforeSnapshot.title) {
      signals.push({
        type: "TITLE_CHANGE",
        indicatesSuccess: true,
        description: `Title changed: "${params.beforeSnapshot.title}" → "${after.title}"`,
        confidence: 0.6,
      });
    }

    // Signal 3: Element count change (DOM mutation)
    const countDiff = Math.abs(after.elementCount - params.beforeSnapshot.elementCount);
    if (countDiff > 0) {
      signals.push({
        type: "DOM_CHANGE",
        indicatesSuccess: true,
        description: `Element count changed by ${countDiff} (${params.beforeSnapshot.elementCount} → ${after.elementCount})`,
        confidence: Math.min(0.5 + countDiff * 0.05, 0.8),
      });
    }

    // Signal 4: Graph delta (check for mutations)
    try {
      const delta = await this.bridge.send({ type: "GRAPH_DELTA" }) as unknown[];
      if (delta && Array.isArray(delta) && delta.length > 0) {
        signals.push({
          type: "GRAPH_DELTA",
          indicatesSuccess: true,
          description: `${delta.length} graph mutations detected after action`,
          confidence: 0.65,
        });
      }
    } catch {
      // Graph delta not available — skip
    }

    // Signal 5: Check for confirmation/error messages in the page
    try {
      const state = await this.bridge.send({ type: "GET_STATE" }) as {
        elements?: Array<{ text?: string; role?: string }>;
      };
      if (state?.elements) {
        for (const el of state.elements) {
          const text = (el.text || "").toLowerCase();
          // Success indicators
          if (/success|saved|updated|confirmed|submitted|done|complete/i.test(text)) {
            signals.push({
              type: "CONFIRMATION_MESSAGE",
              indicatesSuccess: true,
              description: `Success indicator found: "${el.text?.slice(0, 80)}"`,
              confidence: 0.75,
            });
            break;
          }
          // Error indicators
          if (/error|failed|invalid|denied|rejected|problem|unable/i.test(text)) {
            signals.push({
              type: "ERROR_MESSAGE",
              indicatesSuccess: false,
              description: `Error indicator found: "${el.text?.slice(0, 80)}"`,
              confidence: 0.7,
            });
            break;
          }
        }
      }
    } catch {
      // State not available — skip
    }

    // Determine overall status
    const status = this.resolveStatus(signals);
    const confidence = this.resolveConfidence(signals);

    return {
      status,
      signals,
      confidence,
      summary: this.summarize(status, signals),
      verifiedAt: Date.now(),
      latencyMs: Date.now() - t0,
      expected: params.expectedCondition,
      observed: signals.map((s) => s.description).join("; ") || "No signals detected",
    };
  }

  private resolveStatus(signals: VerificationSignal[]): VerificationStatus {
    if (signals.length === 0) return "UNCERTAIN";

    const hasSuccess = signals.some((s) => s.indicatesSuccess);
    const hasFailure = signals.some((s) => !s.indicatesSuccess);

    if (hasFailure && !hasSuccess) return "VERIFIED_FAILURE";
    if (hasSuccess && !hasFailure) return "VERIFIED_SUCCESS";
    if (hasSuccess && hasFailure) {
      // Conflict — compare confidences
      const successConf = Math.max(...signals.filter((s) => s.indicatesSuccess).map((s) => s.confidence));
      const failureConf = Math.max(...signals.filter((s) => !s.indicatesSuccess).map((s) => s.confidence));
      if (failureConf > successConf) return "VERIFIED_FAILURE";
      return "UNCERTAIN";
    }
    return "UNCERTAIN";
  }

  private resolveConfidence(signals: VerificationSignal[]): number {
    if (signals.length === 0) return 0;
    // Use the max confidence among signals
    return Math.round(Math.max(...signals.map((s) => s.confidence)) * 100) / 100;
  }

  private summarize(status: VerificationStatus, signals: VerificationSignal[]): string {
    if (signals.length === 0) return "No verification signals detected; outcome uncertain.";
    const descs = signals.map((s) => `${s.indicatesSuccess ? "✓" : "✗"} ${s.description}`);
    return `${status}: ${descs.join("; ")}`;
  }
}
