// ── Core Types ──────────────────────────────────────────────────────────────
// Foundational types shared across the Trustworthy Autonomous Browser Agent.

/** Unique identifier for a task session. */
export type TaskId = string;

/** High-level status of a task. */
export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "EXECUTING"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT";

/** A single step in a task plan. */
export interface TaskStep {
  id: string;
  description: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED";
  actionType?: string;
  targetDescription?: string;
  /** Result of executing this step. */
  result?: string;
  /** Error message if the step failed. */
  error?: string;
  /** Timestamp when this step was started. */
  startedAt?: number;
  /** Timestamp when this step completed/failed. */
  endedAt?: number;
}

/** The user's high-level goal. */
export interface TaskGoal {
  /** Natural language goal string. */
  text: string;
  /** Optional structured hints. */
  hints?: Record<string, unknown>;
}

/** Top-level task representation. */
export interface Task {
  id: TaskId;
  goal: TaskGoal;
  status: TaskStatus;
  steps: TaskStep[];
  currentStepIndex: number;
  /** URL when the task was created. */
  startUrl?: string;
  /** Current page URL. */
  currentUrl?: string;
  /** Total actions executed. */
  actionCount: number;
  /** Total recovery attempts. */
  recoveryAttempts: number;
  /** Timestamps. */
  createdAt: number;
  updatedAt: number;
  /** Maximum allowed steps. */
  maxSteps: number;
  /** Maximum allowed duration in ms. */
  timeoutMs: number;
}
