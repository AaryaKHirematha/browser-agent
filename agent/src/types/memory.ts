// ── Memory Types ─────────────────────────────────────────────────────────────
// Types for task memory and session state.

import type { TaskId } from "./core.js";
import type { VerificationResult } from "./verification.js";
import type { RecoveryResult } from "./recovery.js";
import type { ApprovalRequest } from "./approval.js";

/** A recorded action in the task history. */
export interface ActionRecord {
  /** Step description. */
  description: string;
  /** Action type (CLICK, TYPE, etc.). */
  actionType: string;
  /** Target description. */
  target?: string;
  /** Whether it succeeded. */
  success: boolean;
  /** Error if it failed. */
  error?: string;
  /** Verification result if verified. */
  verification?: VerificationResult;
  /** Recovery result if recovery was attempted. */
  recovery?: RecoveryResult;
  /** Timestamp. */
  timestamp: number;
}

/** Scoped memory for a single task. */
export interface TaskMemory {
  /** Task ID. */
  taskId: TaskId;
  /** The user's goal (natural language). */
  goal: string;
  /** Current URL. */
  currentUrl: string;
  /** Important entities discovered (form fields, nav items, etc.). */
  knownEntities: string[];
  /** Completed action history. */
  completedActions: ActionRecord[];
  /** Failed action history. */
  failedActions: ActionRecord[];
  /** Verification results. */
  verificationResults: VerificationResult[];
  /** Approval history. */
  approvalHistory: ApprovalRequest[];
  /** Recovery history. */
  recoveryHistory: RecoveryResult[];
  /** Free-form notes the controller can store. */
  notes: string[];
  /** Session creation timestamp. */
  createdAt: number;
  /** Last update timestamp. */
  updatedAt: number;
}

/** Session state encompassing multiple tasks. */
export interface SessionState {
  /** Active task ID, if any. */
  activeTaskId?: TaskId;
  /** All tasks in this session. */
  tasks: Map<TaskId, TaskMemory>;
  /** Session start time. */
  startedAt: number;
}
