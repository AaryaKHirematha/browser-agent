// ── Audit Logger ─────────────────────────────────────────────────────────────
// Structured event logging for all agent decisions and actions.
// NEVER stores sensitive data in plaintext — uses PrivacyShield for sanitization.

import type { AuditEvent, AuditEventType, AuditFilter } from "../types/audit.js";
import type { TaskId } from "../types/core.js";
import { PrivacyShield } from "../privacy/shield.js";

const MAX_LOG_SIZE = 10_000; // Keep at most 10k events in memory

export class AuditLogger {
  private events: AuditEvent[] = [];
  private nextId = 1;
  private shield = new PrivacyShield();

  /** Record an audit event. Sanitizes the details field for sensitive data. */
  log(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
    // Sanitize details to prevent sensitive data from entering the audit log
    let details = event.details;
    if (details) {
      const { text } = this.shield.redact(details);
      details = text;
    }

    const entry: AuditEvent = {
      ...event,
      id: this.nextId++,
      timestamp: Date.now(),
      details,
    };

    this.events.push(entry);

    // Memory cap — drop oldest events
    if (this.events.length > MAX_LOG_SIZE) {
      this.events = this.events.slice(-MAX_LOG_SIZE);
    }

    return entry;
  }

  /** Query audit events with optional filters. */
  query(filter?: AuditFilter): AuditEvent[] {
    let result = this.events;

    if (filter?.taskId) {
      result = result.filter((e) => e.taskId === filter.taskId);
    }
    if (filter?.types?.length) {
      const typeSet = new Set(filter.types);
      result = result.filter((e) => typeSet.has(e.type));
    }
    if (filter?.since) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter?.until) {
      result = result.filter((e) => e.timestamp <= filter.until!);
    }
    if (filter?.domain) {
      result = result.filter((e) => e.domain === filter.domain);
    }
    if (filter?.limit) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  /** Export all events as a JSON-serializable array. */
  export(filter?: AuditFilter): string {
    const events = this.query(filter);
    return JSON.stringify(events, null, 2);
  }

  /** Get a summary of events for a task. */
  taskSummary(taskId: TaskId): {
    totalEvents: number;
    actions: number;
    verifications: number;
    recoveries: number;
    approvals: number;
    securityEvents: number;
    errors: number;
  } {
    const events = this.query({ taskId });
    return {
      totalEvents: events.length,
      actions: events.filter((e) => e.type === "ACTION_EXECUTED" || e.type === "ACTION_FAILED").length,
      verifications: events.filter((e) => e.type === "VERIFICATION_COMPLETED").length,
      recoveries: events.filter((e) => e.type.startsWith("RECOVERY_")).length,
      approvals: events.filter((e) => e.type.startsWith("APPROVAL_")).length,
      securityEvents: events.filter((e) => e.type === "SECURITY_EVENT" || e.type === "PROMPT_INJECTION_DETECTED").length,
      errors: events.filter((e) => e.type === "ERROR").length,
    };
  }

  /** Clear all events. */
  clear(): void {
    this.events = [];
    this.nextId = 1;
  }

  /** Get total event count. */
  get size(): number {
    return this.events.length;
  }
}
