// ── Autonomous LLM Agent Loop (SIH 26171) ────────────────────────────────────
// Multi-step autonomous browser agent driven by real or mock LLM provider.
// Integrates local visual perception, pre-network privacy sanitization, prompt injection
// defense, trust & safety action gate, post-action verification, and self-healing recovery.

import type { ActionProposal } from "../types/action.js";
import type {
  LLMTaskRequest,
  LLMTaskResult,
  LLMStepHistoryItem,
  LLMProviderConfig,
} from "../types/llm.js";
import { LLMProvider, createLLMProvider } from "./provider.js";
import { AdaptiveObserver } from "../observation/adaptive.js";
import { PrivacyShield } from "../privacy/shield.js";
import { PromptInjectionDetector } from "../security/injection.js";
import { ActionValidator } from "../action/validator.js";
import { RiskEngine } from "../risk/engine.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalGateway } from "../approval/gateway.js";
import { VerificationEngine } from "../verification/engine.js";
import { RecoveryEngine } from "../recovery/engine.js";
import { MemoryManager } from "../memory/manager.js";
import { AuditLogger } from "../audit/logger.js";
import { Bridge } from "../bridge.js";

export interface AutonomousAgentConfig {
  maxSteps?: number;
  llmConfig?: Partial<LLMProviderConfig>;
  providerOverride?: LLMProvider;
}

export class AutonomousLLMAgent {
  private provider: LLMProvider;
  private observer: AdaptiveObserver;
  private shield: PrivacyShield;
  private injectionDetector: PromptInjectionDetector;
  private validator: ActionValidator;
  private riskEngine: RiskEngine;
  private policyEngine: PolicyEngine;
  private approvalGateway: ApprovalGateway;
  private verifier: VerificationEngine;
  private recovery: RecoveryEngine;
  private memory: MemoryManager;
  private audit: AuditLogger;
  private bridge?: Bridge;

  constructor(bridge?: Bridge, config?: AutonomousAgentConfig) {
    this.bridge = bridge;
    this.provider = config?.providerOverride ?? createLLMProvider(config?.llmConfig);
    this.observer = new AdaptiveObserver(bridge);
    this.shield = new PrivacyShield();
    this.injectionDetector = new PromptInjectionDetector();
    this.validator = new ActionValidator();
    this.riskEngine = new RiskEngine();
    this.policyEngine = new PolicyEngine();
    this.approvalGateway = new ApprovalGateway();
    this.verifier = new VerificationEngine(bridge);
    this.recovery = new RecoveryEngine(bridge);
    this.memory = new MemoryManager();
    this.audit = new AuditLogger();
  }

  /** Get provider metadata for reporting & diagnostic health endpoints. */
  getProviderMetadata() {
    return this.provider.getMetadata();
  }

  /**
   * Run a multi-step natural language browser task autonomously.
   * Enforces pre-network privacy sanitization, prompt injection defense, and the action safety gate.
   */
  async runTask(userPrompt: string, maxSteps = 10): Promise<LLMTaskResult> {
    const t0 = Date.now();
    const taskId = `llm-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const history: LLMStepHistoryItem[] = [];

    let totalLlmLatency = 0;
    let currentStep = 0;

    this.memory.createTask(taskId, userPrompt, "about:blank");
    this.memory.setActiveTask(taskId);

    this.audit.log({
      type: "TASK_STARTED",
      taskId,
      details: `Started autonomous LLM task: "${userPrompt}" (Provider: ${this.provider.getMetadata().name})`,
    });

    try {
      while (currentStep < maxSteps) {
        currentStep++;

        // 1. Observe current browser state via local visual & adaptive perception
        const rawPerception = await this.observer.perceive({ forceMode: "HYBRID", maxNodes: 30 });

        // 2. Local Privacy Firewall & Sanitization BEFORE sending context to LLM
        const sanitizedPerception = this.shield.sanitizePerception(rawPerception);

        // 3. Scan for prompt injection in webpage content (UNTRUSTED DATA)
        const securityEvents = this.injectionDetector.scanObservation(sanitizedPerception);
        if (this.injectionDetector.hasCriticalInjection(securityEvents)) {
          const criticalEvt = securityEvents.find((e) => e.severity === "CRITICAL");
          this.audit.log({
            type: "PROMPT_INJECTION_DETECTED",
            taskId,
            details: `Prompt injection attack blocked: ${criticalEvt?.description}`,
            severity: "CRITICAL",
          });

          return {
            taskId,
            status: "BLOCKED_SECURITY",
            userPrompt,
            stepsExecuted: currentStep,
            history,
            privacySanitized: true,
            totalLatencyMs: Date.now() - t0,
            llmLatencyMs: totalLlmLatency,
            error: `Security Violation: Prompt injection attack detected on page (${criticalEvt?.description})`,
          };
        }

        // 4. Send SANITIZED context to LLM provider for reasoning
        const request: LLMTaskRequest = {
          taskId,
          userPrompt,
          perception: sanitizedPerception,
          history,
          maxSteps,
        };

        const llmStart = Date.now();
        const decision = await this.provider.decideAction(request);
        totalLlmLatency += Date.now() - llmStart;

        const stepRecord: LLMStepHistoryItem = {
          step: currentStep,
          thought: decision.thought,
          actionProposed: decision.action ?? undefined,
          timestamp: Date.now(),
        };

        // 5. Handle terminal states (DONE or FAIL)
        if (decision.status === "DONE") {
          history.push(stepRecord);
          this.audit.log({
            type: "TASK_COMPLETED",
            taskId,
            details: `Autonomous task completed in ${currentStep} steps: ${decision.finalAnswer}`,
          });

          return {
            taskId,
            status: "SUCCESS",
            userPrompt,
            finalAnswer: decision.finalAnswer ?? decision.thought,
            stepsExecuted: currentStep,
            history,
            privacySanitized: true,
            totalLatencyMs: Date.now() - t0,
            llmLatencyMs: totalLlmLatency,
          };
        }

        if (decision.status === "FAIL" || !decision.action) {
          history.push(stepRecord);
          return {
            taskId,
            status: "FAILED",
            userPrompt,
            stepsExecuted: currentStep,
            history,
            privacySanitized: true,
            totalLatencyMs: Date.now() - t0,
            llmLatencyMs: totalLlmLatency,
            error: decision.thought || "LLM failed to propose a valid action",
          };
        }

        const proposedAction = decision.action;

        // 6. Submit proposed action to Trust & Safety Pipeline (NO direct execution!)
        const validation = this.validator.validate(proposedAction);
        if (!validation.allowed) {
          stepRecord.observationSummary = `Action validation failed: ${validation.reason}`;
          history.push(stepRecord);
          continue;
        }

        const risk = this.riskEngine.assess(proposedAction);
        const policy = this.policyEngine.evaluate(proposedAction, risk);

        // 7. Human Approval Gate Enforcement
        if (policy.action === "REQUIRE_APPROVAL" || risk.approvalRequired) {
          const approvalReq = this.approvalGateway.request({
            action: proposedAction.description,
            target: proposedAction.description,
            domain: proposedAction.domain,
            riskLevel: risk.level,
            reason: policy.reason || risk.reason,
          });

          this.audit.log({
            type: "APPROVAL_REQUESTED",
            taskId,
            details: `High-risk action requires human approval: ${proposedAction.description} (${approvalReq.id})`,
            riskLevel: risk.level,
          });

          history.push(stepRecord);
          return {
            taskId,
            status: "APPROVAL_REQUIRED",
            userPrompt,
            finalAnswer: `High-risk action "${proposedAction.description}" requires human approval (Request ID: ${approvalReq.id}).`,
            stepsExecuted: currentStep,
            history,
            privacySanitized: true,
            totalLatencyMs: Date.now() - t0,
            llmLatencyMs: totalLlmLatency,
          };
        }

        if (policy.action === "DENY") {
          stepRecord.observationSummary = `Policy denied action: ${policy.reason}`;
          history.push(stepRecord);
          continue;
        }

        // 8. Execute approved action over bridge
        let executedSuccess = false;
        if (this.bridge && this.bridge.connected) {
          try {
            await this.bridge.send({ type: proposedAction.type, index: proposedAction.index, ...proposedAction.params });
            executedSuccess = true;
          } catch (err) {
            stepRecord.observationSummary = `Execution error: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          executedSuccess = true;
        }

        stepRecord.actionExecuted = executedSuccess;

        // 9. Post-Action Verification & Self-Healing Recovery
        if (executedSuccess) {
          const verification = await this.verifier.verify({
            actionDescription: proposedAction.description,
          });
          stepRecord.verificationSuccess = verification.status === "VERIFIED_SUCCESS";

          if (verification.status === "VERIFIED_FAILURE") {
            const recResult = await this.recovery.recover({
              error: new Error(verification.summary),
              targetDescription: proposedAction.description,
              originalIndex: proposedAction.index,
              actionType: proposedAction.type,
            });
            stepRecord.observationSummary = `Verification failed; recovery strategy: ${recResult.strategy}`;
          }
        }

        // 10. Update session task memory safely
        this.memory.recordAction(taskId, {
          actionType: proposedAction.type,
          description: proposedAction.description,
          success: executedSuccess,
          timestamp: Date.now(),
        });

        history.push(stepRecord);
      }

      return {
        taskId,
        status: "MAX_STEPS_EXCEEDED",
        userPrompt,
        stepsExecuted: currentStep,
        history,
        privacySanitized: true,
        totalLatencyMs: Date.now() - t0,
        llmLatencyMs: totalLlmLatency,
        error: `Exceeded maximum allowed steps (${maxSteps}) without completing task.`,
      };
    } catch (err) {
      return {
        taskId,
        status: "FAILED",
        userPrompt,
        stepsExecuted: currentStep,
        history,
        privacySanitized: true,
        totalLatencyMs: Date.now() - t0,
        llmLatencyMs: totalLlmLatency,
        error: `Autonomous loop error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
