# Trustworthy Autonomous Browser Agent: Security Model

The intelligence architecture implements a defense-in-depth approach to ensure autonomous actions remain secure, predictable, and aligned with user intent.

## 1. Prompt Injection Defense (`PromptInjectionDetector`)
Scans all incoming observations (HTML, text, ARIA labels, graph nodes) before they reach the LLM. 
- Uses heuristics to detect administrative overrides (e.g., "Ignore previous instructions").
- Flags or blocks malicious content to prevent the LLM from executing attacker-controlled commands.

## 2. Privacy Redaction (`PrivacyShield`)
Ensures sensitive user data is scrubbed from logs and payloads.
- Applies regex patterns to detect Emails, SSNs, Credit Cards, and API Keys.
- Replaces PII with safe tokens (e.g., `[REDACTED_EMAIL]`) *before* the observation is sent to external APIs or Audit Logger.

## 3. Risk Assessment (`RiskEngine`)
Evaluates every proposed action to determine its potential blast radius.
- Analyzes domain sensitivity (e.g., banking vs. public wiki).
- Checks action types (e.g., `DELETE`, `TYPE_PASSWORD` vs `READ`, `SCROLL`).
- Assigns a severity level (LOW, MEDIUM, HIGH, CRITICAL).

## 4. Policy Enforcement (`PolicyEngine`)
Uses the Risk Engine output against predefined access control lists (ACLs) and rules.
- Preemptively DENIES actions that violate strict rules (e.g., "No file downloads").
- Routes high-risk actions to the `ApprovalGateway`.

## 5. Human-in-the-Loop (`ApprovalGateway`)
Suspends task execution (`WAITING_FOR_APPROVAL`) when high-risk boundaries are crossed.
- Pushes authorization requests to the user dashboard.
- Execution only resumes upon explicit cryptographic or manual `APPROVED` response.

## 6. Audit Stream (`AuditLogger`)
An immutable, structured event stream tracking every state transition, LLM proposal, API request, and DOM interaction. Ensures complete post-incident forensic capability.
