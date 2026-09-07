// ── Task Memory ──────────────────────────────────────────────────────────────
// Session-scoped memory for tracking task state, entities, and history.
// Memory is privacy-aware and resistant to cross-task contamination.

import type { TaskId } from "../types/core.js";
import type { TaskMemory, ActionRecord, SessionState } from "../types/memory.js";
import type { VerificationResult } from "../types/verification.js";
import type { RecoveryResult } from "../types/recovery.js";
import type { ApprovalRequest } from "../types/approval.js";

const MAX_ACTION_HISTORY = 100;
const MAX_ENTITIES = 200;
const MAX_NOTES = 50;

let taskIdCounter = 1;

export function generateTaskId(): TaskId {
  return `task_${taskIdCounter++}_${Date.now()}`;
}

export class MemoryManager {
  private session: SessionState = {
    tasks: new Map(),
    startedAt: Date.now(),
  };

  /** Create a new task memory scope. */
  createTask(taskId: TaskId, goal: string, url: string): TaskMemory {
    const memory: TaskMemory = {
      taskId,
      goal,
      currentUrl: url,
      knownEntities: [],
      completedActions: [],
      failedActions: [],
      verificationResults: [],
      approvalHistory: [],
      recoveryHistory: [],
      notes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.session.tasks.set(taskId, memory);
    this.session.activeTaskId = taskId;
    return memory;
  }

  /** Get memory for a specific task. */
  getTask(taskId: TaskId): TaskMemory | undefined {
    return this.session.tasks.get(taskId);
  }

  /** Get the active task memory. */
  getActiveTask(): TaskMemory | undefined {
    if (!this.session.activeTaskId) return undefined;
    return this.session.tasks.get(this.session.activeTaskId);
  }

  /** Record a completed action. */
  recordAction(taskId: TaskId, record: ActionRecord): void {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return;

    if (record.success) {
      mem.completedActions.push(record);
      if (mem.completedActions.length > MAX_ACTION_HISTORY) {
        mem.completedActions = mem.completedActions.slice(-MAX_ACTION_HISTORY);
      }
    } else {
      mem.failedActions.push(record);
      if (mem.failedActions.length > MAX_ACTION_HISTORY) {
        mem.failedActions = mem.failedActions.slice(-MAX_ACTION_HISTORY);
      }
    }
    mem.updatedAt = Date.now();
  }

  /** Record a verification result. */
  recordVerification(taskId: TaskId, result: VerificationResult): void {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return;
    mem.verificationResults.push(result);
    mem.updatedAt = Date.now();
  }

  /** Record a recovery attempt. */
  recordRecovery(taskId: TaskId, result: RecoveryResult): void {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return;
    mem.recoveryHistory.push(result);
    mem.updatedAt = Date.now();
  }

  /** Record an approval. */
  recordApproval(taskId: TaskId, approval: ApprovalRequest): void {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return;
    mem.approvalHistory.push(approval);
    mem.updatedAt = Date.now();
  }

  /** Update the current URL. */
  updateUrl(taskId: TaskId, url: string): void {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return;
    mem.currentUrl = url;
    mem.updatedAt = Date.now();
  }

  /** Add a known entity (form field, navigation item, etc.). */
  addEntity(taskId: TaskId, entity: string): void {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return;
    if (!mem.knownEntities.includes(entity)) {
      mem.knownEntities.push(entity);
      if (mem.knownEntities.length > MAX_ENTITIES) {
        mem.knownEntities = mem.knownEntities.slice(-MAX_ENTITIES);
      }
    }
    mem.updatedAt = Date.now();
  }

  /** Add a note. */
  addNote(taskId: TaskId, note: string): void {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return;
    mem.notes.push(note);
    if (mem.notes.length > MAX_NOTES) {
      mem.notes = mem.notes.slice(-MAX_NOTES);
    }
    mem.updatedAt = Date.now();
  }

  /** Get a JSON-serializable snapshot of the task state for the MCP tool. */
  getTaskSnapshot(taskId: TaskId): Record<string, unknown> | null {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return null;
    return {
      taskId: mem.taskId,
      goal: mem.goal,
      currentUrl: mem.currentUrl,
      knownEntities: mem.knownEntities.slice(-20),
      completedActionsCount: mem.completedActions.length,
      failedActionsCount: mem.failedActions.length,
      recentActions: mem.completedActions.slice(-5).map((a) => ({
        description: a.description,
        success: a.success,
        timestamp: a.timestamp,
      })),
      verificationCount: mem.verificationResults.length,
      recoveryCount: mem.recoveryHistory.length,
      approvalCount: mem.approvalHistory.length,
      notes: mem.notes.slice(-10),
      createdAt: mem.createdAt,
      updatedAt: mem.updatedAt,
    };
  }

  /** Reset a task's memory (for re-running). */
  resetTask(taskId: TaskId): boolean {
    const mem = this.session.tasks.get(taskId);
    if (!mem) return false;
    mem.completedActions = [];
    mem.failedActions = [];
    mem.verificationResults = [];
    mem.recoveryHistory = [];
    mem.approvalHistory = [];
    mem.knownEntities = [];
    mem.notes = [];
    mem.updatedAt = Date.now();
    return true;
  }

  /** Delete a task's memory entirely. */
  deleteTask(taskId: TaskId): boolean {
    if (this.session.activeTaskId === taskId) {
      this.session.activeTaskId = undefined;
    }
    return this.session.tasks.delete(taskId);
  }

  /** Get the active task ID. */
  get activeTaskId(): TaskId | undefined {
    return this.session.activeTaskId;
  }

  /** Set the active task. */
  setActiveTask(taskId: TaskId): void {
    this.session.activeTaskId = taskId;
  }
}
