# Trustworthy Autonomous Browser Agent: End-to-End Execution

The End-to-End Execution model is governed by the `TaskRunner` and `ExecutionStateMachine`, which work together to orchestrate the intelligence modules in a secure, verifiable closed loop.

## Execution State Machine

Every task follows a strict lifecycle, transitioning through defined states:

1.  **IDLE**: Task initialized.
2.  **PLANNING**: Agent decomposes the goal.
3.  **OBSERVING**: `AdaptiveObserver` extracts visual and structural data from the DOM.
4.  **DECIDING**: LLM (external) proposes an `ActionProposal`.
5.  **RISK_ASSESSING**: `RiskEngine` evaluates the proposal for potential harm.
6.  **POLICY_CHECKING**: `PolicyEngine` enforces domain/action rules based on risk.
7.  **WAITING_FOR_APPROVAL**: If required, `ApprovalGateway` holds execution until human authorization.
8.  **EXECUTING**: Action is dispatched to the Chrome bridge.
9.  **VERIFYING**: `VerificationEngine` checks DOM/URL/Visual delta to confirm success.
10. **RECOVERING**: If execution fails, `RecoveryEngine` attempts fallback strategies (e.g., semantic matching for stale elements).
11. **COMPLETED / FAILED / CANCELLED**: Terminal states.

## The Closed Loop

The `TaskRunner` (`agent/src/controller/runner.ts`) encapsulates all intelligence modules:
- It maintains the task record and state machine.
- It intercepts raw observations and runs them through the `PromptInjectionDetector`.
- It executes actions via the `Bridge` and captures before/after states for verification.
- It updates the `MemoryManager` with the result, enriching the context for the next step.
- All actions, transitions, and security detections are recorded in the `AuditLogger`.

This design ensures that no action can be executed without passing through observation parsing, risk assessment, policy enforcement, and verification.
