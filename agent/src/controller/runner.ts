// ── Autonomous Task Runner ────────────────────────────────────────────────
// End-to-end execution controller driving the complete Trustworthy Browser Agent lifecycle.

import { ExecutionStateMachine, ExecutionState } from "./state-machine.js";
import { AdaptiveObserver } from "../observation/adaptive.js";
import { RiskEngine } from "../risk/engine.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalGateway } from "../approval/gateway.js";
import { VerificationEngine } from "../verification/engine.js";
import { RecoveryEngine } from "../recovery/engine.js";
import { PrivacyShield } from "../privacy/shield.js";
import { PromptInjectionDetector } from "../security/injection.js";
import { MemoryManager } from "../memory/manager.js";
import { AuditLogger } from "../audit/logger.js";
import { Bridge } from "../bridge.js";
import { ActionValidator } from "../action/validator.js";
import { ActionProposal } from "../types/index.js";

export interface TaskRecord {
  id: string;
  goal: string;
  startUrl?: string;
  state: ExecutionState;
  stateMachine: ExecutionStateMachine;
  currentStepIndex: number;
  steps: Array<{
    id: string;
    description: string;
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    actionProposal?: ActionProposal;
    result?: unknown;
    error?: string;
  }>;
  pendingApprovalId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export class TaskRunner {
  private tasks = new Map<string, TaskRecord>();
  public readonly observer: AdaptiveObserver;
  public readonly riskEngine: RiskEngine;
  public readonly policyEngine: PolicyEngine;
  public readonly approvalGateway: ApprovalGateway;
  public readonly verificationEngine: VerificationEngine;
  public readonly recoveryEngine: RecoveryEngine;
  public readonly privacyShield: PrivacyShield;
  public readonly injectionDetector: PromptInjectionDetector;
  public readonly memoryManager: MemoryManager;
  public readonly actionValidator: ActionValidator;
  public readonly auditLogger: AuditLogger;

  constructor(private bridge: Bridge) {
    this.actionValidator = new ActionValidator();
    this.auditLogger = new AuditLogger();
    this.memoryManager = new MemoryManager();
    this.privacyShield = new PrivacyShield();
    this.injectionDetector = new PromptInjectionDetector();
    this.riskEngine = new RiskEngine();
    this.policyEngine = new PolicyEngine();
    this.approvalGateway = new ApprovalGateway();
    this.observer = new AdaptiveObserver(bridge);
    this.verificationEngine = new VerificationEngine(bridge);
    this.recoveryEngine = new RecoveryEngine(bridge);
  }

  public createTask(goal: string, startUrl?: string): TaskRecord {
    const id = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sm = new ExecutionStateMachine(id, this.auditLogger);

    const record: TaskRecord = {
      id,
      goal,
      startUrl,
      state: sm.state,
      stateMachine: sm,
      currentStepIndex: 0,
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(id, record);
    this.memoryManager.createTask(id, goal, startUrl ?? "about:blank");
    this.auditLogger.log({
      taskId: id,
      type: "TASK_STARTED",
      domain: startUrl || "unknown",
      details: `Created task for goal: "${goal}"`,
    });

    return record;
  }

  public getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  public pauseTask(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    if (record.state === "COMPLETED" || record.state === "FAILED" || record.state === "CANCELLED") {
      return false;
    }
    this.auditLogger.log({
      taskId,
      type: "ACTION_PROPOSED",
      domain: "system",
      details: "Task paused by user",
    });
    return true;
  }

  public resumeTask(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    if (record.state === "WAITING_FOR_APPROVAL") {
      if (record.pendingApprovalId) {
        const req = this.approvalGateway.get(record.pendingApprovalId);
        if (req && req.status === "APPROVED") {
          record.stateMachine.transitionTo("EXECUTING");
          record.state = record.stateMachine.state;
          record.pendingApprovalId = undefined;
          return true;
        }
      }
    }
    return false;
  }

  public cancelTask(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    if (record.state !== "COMPLETED" && record.state !== "FAILED" && record.state !== "CANCELLED") {
      record.stateMachine.transitionTo("CANCELLED");
      record.state = record.stateMachine.state;
      record.updatedAt = Date.now();
      this.auditLogger.log({
        taskId,
        type: "TASK_CANCELLED",
        domain: "system",
        details: "Task cancelled",
      });
      return true;
    }
    return false;
  }

  /**
   * Executes the autonomous loop for a given task step by step.
   */
  public async stepTask(taskId: string, actionProposal?: ActionProposal): Promise<{
    state: ExecutionState;
    actionExecuted?: boolean;
    verificationResult?: unknown;
    approvalRequired?: boolean;
    approvalId?: string;
    error?: string;
  }> {
    const record = this.tasks.get(taskId);
    if (!record) throw new Error(`Task ${taskId} not found`);

    if (record.state === "IDLE") {
      record.stateMachine.transitionTo("PLANNING");
      record.state = record.stateMachine.state;
      this.auditLogger.log({ taskId, type: "TASK_STARTED", domain: "system", details: `Planning goal: ${record.goal}` });
    }

    if (record.state === "PLANNING") {
      record.stateMachine.transitionTo("OBSERVING");
      record.state = record.stateMachine.state;
    }

    // 1. OBSERVE
    if (record.state === "OBSERVING") {
      const obs = await this.observer.observe({ task: record.goal });
      
      // Security Injection Scan on webpage contents
      const rawText = JSON.stringify(obs.elements || []);
      const injectionEvents = this.injectionDetector.scan(rawText, "webpage");
      if (injectionEvents.some(e => e.severity === "ERROR" || e.severity === "WARNING")) {
        this.auditLogger.log({
          taskId,
          type: "PROMPT_INJECTION_DETECTED",
          domain: obs.meta.url || "unknown",
          details: `Prompt injection attack detected on page`,
          severity: "CRITICAL",
        });
      }

      record.stateMachine.transitionTo("DECIDING");
      record.state = record.stateMachine.state;
    }

    // If no specific action provided, just return current state
    if (!actionProposal) {
      return { state: record.state };
    }

    if (actionProposal.type === "FINISH" as any) {
      record.stateMachine.transitionTo("COMPLETED");
      record.state = record.stateMachine.state;
      record.completedAt = Date.now();
      this.auditLogger.log({ taskId, type: "TASK_COMPLETED", domain: record.startUrl || "system", details: "Task finished successfully" });
      return { state: record.state };
    }

    let riskAssessment = this.riskEngine.assess(actionProposal);

    // If state is not already EXECUTING (e.g. resumed after human approval), run safety pipeline
    if (record.state !== "EXECUTING") {
      // 1.5 STRUCTURAL ACTION VALIDATION
      const validation = this.actionValidator.validate(actionProposal);
      if (!validation.allowed) {
        record.stateMachine.transitionTo("FAILED");
        record.state = record.stateMachine.state;
        this.auditLogger.log({
          taskId,
          type: "ACTION_FAILED",
          domain: actionProposal.domain || "unknown",
          details: `Action validation failed: ${validation.reason}`,
          result: "FAILURE",
        });
        return { state: record.state, error: `Action validation failed: ${validation.reason}` };
      }

      // 2. DECIDE -> RISK ASSESSMENT
      if (record.state === "DECIDING") {
        record.stateMachine.transitionTo("RISK_ASSESSING");
        record.state = record.stateMachine.state;
      }
      riskAssessment = this.riskEngine.assess(actionProposal);

      // 3. POLICY CHECK
      if (record.state === "RISK_ASSESSING") {
        record.stateMachine.transitionTo("POLICY_CHECKING");
        record.state = record.stateMachine.state;
      }
      const policyDecision = this.policyEngine.evaluate(actionProposal, riskAssessment);

      if (policyDecision.action === "DENY") {
        record.stateMachine.transitionTo("FAILED");
        record.state = record.stateMachine.state;
        this.auditLogger.log({
          taskId,
          type: "POLICY_EVALUATED",
          domain: actionProposal.domain,
          details: `Policy denied action: ${policyDecision.reason}`,
          riskLevel: riskAssessment.level,
        });
        return { state: record.state, error: policyDecision.reason };
      }

      // 4. APPROVAL IF REQUIRED
      if (policyDecision.action === "REQUIRE_APPROVAL" || riskAssessment.approvalRequired) {
        record.stateMachine.transitionTo("WAITING_FOR_APPROVAL");
        record.state = record.stateMachine.state;
        const appReq = this.approvalGateway.request({
          action: actionProposal.description,
          target: actionProposal.description,
          domain: actionProposal.domain,
          riskLevel: riskAssessment.level,
          reason: policyDecision.reason || riskAssessment.reason,
        });
        record.pendingApprovalId = appReq.id;
        (record as any).pendingProposal = actionProposal;

        this.auditLogger.log({
          taskId,
          type: "APPROVAL_REQUESTED",
          domain: actionProposal.domain,
          details: `Human approval requested for high-risk action: ${actionProposal.description}`,
          riskLevel: riskAssessment.level,
        });

        return { state: record.state, approvalRequired: true, approvalId: appReq.id };
      }
    }

    // 5. EXECUTE
    if (record.state !== "EXECUTING") {
      record.stateMachine.transitionTo("EXECUTING");
      record.state = record.stateMachine.state;
    }

    // Verify proposal matching if resuming after approval
    if ((record as any).pendingProposal) {
      const approvedProp = (record as any).pendingProposal;
      (record as any).pendingProposal = undefined;
      if (actionProposal.type !== approvedProp.type || actionProposal.domain !== approvedProp.domain) {
        record.stateMachine.transitionTo("FAILED");
        record.state = record.stateMachine.state;
        return { state: record.state, error: "APPROVAL_MISMATCH: Action proposal does not match approved proposal" };
      }
    }

    // Snapshot state before action for verification
    const beforeState: any = await this.bridge.send({ type: "GET_STATE" }).catch(() => null);

    let executeSuccess = true;
    let executeError: any = null;

    try {
      if (actionProposal.type === "CLICK" && actionProposal.params?.index !== undefined) {
        await this.bridge.send({ type: "CLICK", index: actionProposal.params.index });
      } else if (actionProposal.type === "TYPE" && actionProposal.params?.index !== undefined && actionProposal.params?.text) {
        await this.bridge.send({ type: "TYPE", index: actionProposal.params.index, text: actionProposal.params.text });
      } else if (actionProposal.type === "NAVIGATE" && actionProposal.params?.url) {
        await this.bridge.send({ type: "NAVIGATE", url: actionProposal.params.url });
      }
    } catch (err: any) {
      executeSuccess = false;
      executeError = err;
    }

    this.auditLogger.log({
      taskId,
      type: "ACTION_EXECUTED",
      domain: actionProposal.domain,
      action: actionProposal.type,
      details: `Executed action: ${actionProposal.description}`,
      riskLevel: riskAssessment.level,
    });

    // Handle failure and recovery if execution threw an error
    if (!executeSuccess) {
      record.stateMachine.transitionTo("RECOVERING");
      record.state = record.stateMachine.state;
      
      const recResult = await this.recoveryEngine.recover({
        error: executeError || new Error("Action failed"),
        targetDescription: actionProposal.description,
        originalIndex: typeof actionProposal.params?.index === "number" ? actionProposal.params.index : undefined,
        actionType: actionProposal.type,
      });

      if (!recResult.recovered) {
        record.stateMachine.transitionTo("FAILED");
        record.state = record.stateMachine.state;
        return { state: record.state, error: `Recovery failed: ${recResult.error}` };
      }
    }

    // 6. VERIFY
    record.stateMachine.transitionTo("VERIFYING");
    record.state = record.stateMachine.state;

    const verificationResult = await this.verificationEngine.verify({
      actionDescription: actionProposal.description,
      beforeSnapshot: beforeState ? {
        url: beforeState.url || actionProposal.domain,
        title: beforeState.title || "",
        elementCount: beforeState.elements?.length || 0,
        timestamp: Date.now() - 500,
      } : {
        url: actionProposal.domain,
        title: "",
        elementCount: 0,
        timestamp: Date.now() - 500,
      },
    });

    this.auditLogger.log({
      taskId,
      type: "VERIFICATION_COMPLETED",
      domain: actionProposal.domain,
      details: `Verification status: ${verificationResult.status}`,
    });

    // 7. MEMORY UPDATE
    this.memoryManager.recordAction(taskId, {
      description: actionProposal.description,
      actionType: actionProposal.type,
      target: actionProposal.description,
      success: true,
      verification: verificationResult,
      timestamp: Date.now(),
    });

    // Transition back to OBSERVING for next step
    record.stateMachine.transitionTo("OBSERVING");
    record.state = record.stateMachine.state;

    return {
      state: record.state,
      actionExecuted: true,
      verificationResult,
    };
  }
}
