# SIH Live Demo Script (5-10 Minutes)

**Objective**: Showcase the Trustworthy Autonomous Browser Agent's safety, security, and verification intelligence to the SIH judges.

---

### Step 1: Introduction & The Problem (1 minute)
- **Speaker**: "Traditional browser automation is brittle and insecure. LLM agents running wild on the web can accidentally wipe out databases, hallucinate on stale DOMs, and leak PII. We built an agent that doesn't just automate, it *verifies*, *recovers*, and *secures* itself."
- **Action**: Show the architectural diagram in `docs/architecture.md`.

### Step 2: The Safety Framework - Unit & E2E Tests (1 minute)
- **Speaker**: "We built an enterprise-grade intelligence stack. Let me prove it."
- **Action**: 
  - Terminal 1: Run `npm test` -> Show all 12 core intelligence modules passing (Privacy, Risk, Policy, Prompt Injection).
  - Terminal 2: Run `node test-e2e-all.mjs` -> Show the 11-stage autonomous state machine validation passing in milliseconds.

### Step 3: Prompt Injection & Privacy Shield (2 minutes)
- **Speaker**: "Let's say the agent visits a forum with a malicious prompt injection trying to steal passwords."
- **Action**: Show `fixtures/3-prompt-injection.html`.
- **Speaker**: "Our agent scans every observation BEFORE it reaches the LLM. It detects the 'Ignore previous instructions' and flags it as CRITICAL."
- **Action**: Explain the Privacy Shield regex blocking SSNs, Credit Cards, and API keys (`fixtures/4-sensitive-data.html`). 

### Step 4: High-Risk Human Approval (2 minutes)
- **Speaker**: "What if the agent decides to delete an account?"
- **Action**: Trigger Phase 10 approval test visually (or explain the output). 
- **Speaker**: "The Risk Engine detects a 'DELETE' action on a sensitive domain. It halts execution at `WAITING_FOR_APPROVAL` and pushes a notification to the Web Dashboard."
- **Action**: Open `http://localhost:8778/dashboard` (if running) and show the Approval Card.

### Step 5: Self-Healing & Verification (2 minutes)
- **Speaker**: "Webpages change constantly. What if a button moves?"
- **Action**: Explain the Recovery Engine (Phase 7). "If the exact index is lost, we fall back to semantic matching (e.g., finding the button labeled 'Submit')."
- **Speaker**: "And how do we know the click worked? The Verification Engine compares the before-and-after DOM state, URL, and Visual Delta to provide a confidence score."

### Step 6: Conclusion (1 minute)
- **Speaker**: "By wrapping the LLM in a strict state machine with localized risk, privacy, and verification engines, we've created an autonomous agent that enterprises can actually trust. Thank you."
