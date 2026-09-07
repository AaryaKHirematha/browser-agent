// ── Execution State Machine ──────────────────────────────────────────────
// Enforces valid lifecycle state transitions for the autonomous execution controller.

import { AuditLogger } from "../audit/logger.js";

export type ExecutionState =
  | "IDLE"
  | "PLANNING"
  | "OBSERVING"
  | "DECIDING"
  | "RISK_ASSESSING"
  | "POLICY_CHECKING"
  | "WAITING_FOR_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "RECOVERING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface StateTransitionEvent {
  taskId: string;
  from: ExecutionState;
  to: ExecutionState;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const ALLOWED_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  IDLE: ["PLANNING", "CANCELLED"],
  PLANNING: ["OBSERVING", "FAILED", "CANCELLED"],
  OBSERVING: ["DECIDING", "FAILED", "CANCELLED"],
  DECIDING: ["RISK_ASSESSING", "COMPLETED", "FAILED", "CANCELLED"],
  RISK_ASSESSING: ["POLICY_CHECKING", "FAILED", "CANCELLED"],
  POLICY_CHECKING: ["EXECUTING", "WAITING_FOR_APPROVAL", "FAILED", "CANCELLED"],
  WAITING_FOR_APPROVAL: ["EXECUTING", "FAILED", "CANCELLED"],
  EXECUTING: ["VERIFYING", "RECOVERING", "FAILED", "CANCELLED"],
  VERIFYING: ["OBSERVING", "COMPLETED", "RECOVERING", "FAILED", "CANCELLED"],
  RECOVERING: ["OBSERVING", "EXECUTING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export class ExecutionStateMachine {
  private currentState: ExecutionState = "IDLE";
  private history: StateTransitionEvent[] = [];

  constructor(
    public readonly taskId: string,
    private logger?: AuditLogger
  ) {}

  public get state(): ExecutionState {
    return this.currentState;
  }

  public get transitionHistory(): readonly StateTransitionEvent[] {
    return this.history;
  }

  public transitionTo(to: ExecutionState, metadata?: Record<string, unknown>): boolean {
    const allowed = ALLOWED_TRANSITIONS[this.currentState];
    if (!allowed || !allowed.includes(to)) {
      const errorMsg = `Invalid state transition for task ${this.taskId}: ${this.currentState} -> ${to}`;
      if (this.logger) {
        this.logger.log({
          taskId: this.taskId,
          type: "SECURITY_EVENT",
          domain: "system",
          details: errorMsg,
          riskLevel: "HIGH",
        });
      }
      throw new Error(errorMsg);
    }

    const event: StateTransitionEvent = {
      taskId: this.taskId,
      from: this.currentState,
      to,
      timestamp: Date.now(),
      metadata,
    };

    this.history.push(event);
    this.currentState = to;

    if (this.logger) {
      this.logger.log({
        taskId: this.taskId,
        type: "TASK_STARTED",
        domain: "system",
        details: `State transition: ${event.from} -> ${to}`,
      });
    }

    return true;
  }
}
