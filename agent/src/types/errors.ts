// ── Error Types ──────────────────────────────────────────────────────────────
// Standardized error classes for the Trustworthy Autonomous Browser Agent.

/** Error codes for all known failure modes. */
export type AgentErrorCode =
  | "ELEMENT_NOT_FOUND"
  | "STALE_ELEMENT"
  | "PAGE_CHANGED"
  | "NAVIGATION_FAILURE"
  | "TIMEOUT"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_REJECTED"
  | "VERIFICATION_FAILED"
  | "RECOVERY_FAILED"
  | "MAX_STEPS_EXCEEDED"
  | "MAX_RETRIES_EXCEEDED"
  | "TASK_CANCELLED"
  | "EXTENSION_DISCONNECTED"
  | "SENSITIVE_DATA_BLOCKED"
  | "SECURITY_VIOLATION"
  | "PROMPT_INJECTION"
  | "EVAL_BLOCKED"
  | "UNKNOWN";

/** Severity of the error. */
export type ErrorSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Recommended action for handling the error. */
export type RecommendedAction =
  | "RETRY"
  | "RE_OBSERVE"
  | "RECOVER"
  | "REQUEST_APPROVAL"
  | "ABORT"
  | "WAIT"
  | "NAVIGATE_BACK"
  | "ESCALATE";

/** Base error class for all agent errors. */
export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly recoverable: boolean;
  readonly severity: ErrorSeverity;
  readonly recommendedAction: RecommendedAction;
  readonly timestamp: number;

  constructor(
    code: AgentErrorCode,
    message: string,
    options: {
      recoverable?: boolean;
      severity?: ErrorSeverity;
      recommendedAction?: RecommendedAction;
      cause?: Error;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AgentError";
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.severity = options.severity ?? "MEDIUM";
    this.recommendedAction = options.recommendedAction ?? "ABORT";
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      severity: this.severity,
      recommendedAction: this.recommendedAction,
      timestamp: this.timestamp,
    };
  }
}

// ── Specific Error Subclasses ───────────────────────────────────────────────

export class ElementNotFoundError extends AgentError {
  constructor(index: number, registrySize: number) {
    super("ELEMENT_NOT_FOUND", `No element for index ${index}; registry has ${registrySize}`, {
      recoverable: true,
      severity: "LOW",
      recommendedAction: "RE_OBSERVE",
    });
    this.name = "ElementNotFoundError";
  }
}

export class StaleElementError extends AgentError {
  constructor(index: number) {
    super("STALE_ELEMENT", `Element ${index} is detached; page changed`, {
      recoverable: true,
      severity: "LOW",
      recommendedAction: "RECOVER",
    });
    this.name = "StaleElementError";
  }
}

export class PageChangedError extends AgentError {
  constructor(details?: string) {
    super("PAGE_CHANGED", `Page changed unexpectedly${details ? `: ${details}` : ""}`, {
      recoverable: true,
      severity: "MEDIUM",
      recommendedAction: "RE_OBSERVE",
    });
    this.name = "PageChangedError";
  }
}

export class NavigationError extends AgentError {
  constructor(url: string, details?: string) {
    super("NAVIGATION_FAILURE", `Navigation to ${url} failed${details ? `: ${details}` : ""}`, {
      recoverable: true,
      severity: "MEDIUM",
      recommendedAction: "RETRY",
    });
    this.name = "NavigationError";
  }
}

export class TimeoutError extends AgentError {
  constructor(operation: string, timeoutMs: number) {
    super("TIMEOUT", `${operation} timed out after ${timeoutMs}ms`, {
      recoverable: true,
      severity: "MEDIUM",
      recommendedAction: "RETRY",
    });
    this.name = "TimeoutError";
  }
}

export class PolicyDeniedError extends AgentError {
  constructor(action: string, domain: string, reason: string) {
    super("POLICY_DENIED", `Policy denied ${action} on ${domain}: ${reason}`, {
      recoverable: false,
      severity: "HIGH",
      recommendedAction: "ABORT",
    });
    this.name = "PolicyDeniedError";
  }
}

export class ApprovalRequiredError extends AgentError {
  readonly approvalRequestId: string;
  constructor(requestId: string, action: string) {
    super("APPROVAL_REQUIRED", `Action "${action}" requires human approval (request: ${requestId})`, {
      recoverable: true,
      severity: "MEDIUM",
      recommendedAction: "REQUEST_APPROVAL",
    });
    this.name = "ApprovalRequiredError";
    this.approvalRequestId = requestId;
  }
}

export class ApprovalExpiredError extends AgentError {
  constructor(requestId: string) {
    super("APPROVAL_EXPIRED", `Approval request ${requestId} expired`, {
      recoverable: false,
      severity: "MEDIUM",
      recommendedAction: "ABORT",
    });
    this.name = "ApprovalExpiredError";
  }
}

export class VerificationFailedError extends AgentError {
  constructor(action: string, details?: string) {
    super("VERIFICATION_FAILED", `Verification failed for "${action}"${details ? `: ${details}` : ""}`, {
      recoverable: true,
      severity: "MEDIUM",
      recommendedAction: "RECOVER",
    });
    this.name = "VerificationFailedError";
  }
}

export class RecoveryFailedError extends AgentError {
  constructor(strategy: string, attempts: number) {
    super("RECOVERY_FAILED", `Recovery failed after ${attempts} attempts using ${strategy}`, {
      recoverable: false,
      severity: "HIGH",
      recommendedAction: "ABORT",
    });
    this.name = "RecoveryFailedError";
  }
}

export class SecurityViolationError extends AgentError {
  constructor(details: string) {
    super("SECURITY_VIOLATION", `Security violation: ${details}`, {
      recoverable: false,
      severity: "CRITICAL",
      recommendedAction: "ABORT",
    });
    this.name = "SecurityViolationError";
  }
}

export class PromptInjectionError extends AgentError {
  constructor(details: string) {
    super("PROMPT_INJECTION", `Potential prompt injection detected: ${details}`, {
      recoverable: false,
      severity: "CRITICAL",
      recommendedAction: "ABORT",
    });
    this.name = "PromptInjectionError";
  }
}
