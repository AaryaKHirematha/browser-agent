# Trustworthy Autonomous Browser Agent: Testing & Verification Strategy

Our agent uses a multi-layered testing strategy to guarantee security, stability, and intelligence module correctness.

## 1. Unit Testing (`test-unit.mjs`)
Validates individual modules in isolation.
- **RiskEngine**: Verifies classifications (LOW vs HIGH risk scenarios).
- **PolicyEngine**: Tests ACLs and domain constraints.
- **PrivacyShield**: Tests Regex logic for PII redaction.
- **PromptInjectionDetector**: Verifies malicious payload interception.
- **VerificationEngine**: Tests delta detection logic.
- **RecoveryEngine**: Checks stale element fallback routing.

## 2. End-to-End Validation (`test-e2e-all.mjs`)
Validates the complete `TaskRunner` execution loop (Phases 5-19).
- **Mock Bridge & Fixtures**: Uses local HTML fixtures (`fixtures/`) and a deterministic `MockBridge` to simulate Chrome interactions without flaky UI automation.
- **Closed-Loop Sequence**: Verifies transitions from `PLANNING` -> `OBSERVING` -> `DECIDING` -> `RISK_ASSESSING` -> `POLICY_CHECKING` -> `EXECUTING` -> `VERIFYING`.
- **Negative Boundaries**: Tests state machine resilience (e.g., throwing errors when skipping `APPROVAL`).
- **Memory & Audit Tracking**: Asserts event history correctness and cross-task context isolation.

Run all tests via:
```bash
npm run build
npm test
node test-e2e-all.mjs
```
