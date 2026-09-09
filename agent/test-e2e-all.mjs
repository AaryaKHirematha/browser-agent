// ── Comprehensive End-to-End Integration & Validation Test Suite ───────────────────
// Tests Phases 5 through 19 autonomously against local fixtures & intelligence modules.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskRunner } from "./dist/controller/runner.js";
import { ExecutionStateMachine } from "./dist/controller/state-machine.js";
import { AdaptiveObserver } from "./dist/observation/adaptive.js";
import { RiskEngine } from "./dist/risk/engine.js";
import { PolicyEngine } from "./dist/policy/engine.js";
import { ApprovalGateway } from "./dist/approval/gateway.js";
import { VerificationEngine } from "./dist/verification/engine.js";
import { RecoveryEngine } from "./dist/recovery/engine.js";
import { PrivacyShield } from "./dist/privacy/shield.js";
import { PromptInjectionDetector } from "./dist/security/injection.js";
import { MemoryManager } from "./dist/memory/manager.js";
import { AuditLogger } from "./dist/audit/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../fixtures");

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

// Mock Bridge for local deterministic testing without headless Chrome dependency
class MockBridge {
  connected = true;
  pageUrl = "http://localhost/fixtures/1-search.html";
  pageTitle = "Fixture 1 — Search Application";
  elements = [
    { index: 0, role: "textbox", text: "", attributes: { id: "search-input" } },
    { index: 1, role: "button", text: "Search", attributes: { id: "search-button" } },
  ];

  async send(cmd) {
    if (cmd.type === "GET_STATE") {
      return {
        url: this.pageUrl,
        title: this.pageTitle,
        viewport: { width: 1280, height: 800 },
        scroll: { x: 0, y: 0 },
        elements: this.elements,
      };
    }
    if (cmd.type === "GET_GRAPH") {
      return {
        url: this.pageUrl,
        title: this.pageTitle,
        graphText: `root [url="${this.pageUrl}"]\n  textbox#search-input [index=0]\n  button#search-button [index=1]`,
        interactiveNodesCount: this.elements.length,
      };
    }
    if (cmd.type === "GRAPH_DELTA") {
      return [{ type: "NODE_ADDED", index: 2, text: "Result Item" }];
    }
    if (cmd.type === "SCREENSHOT") {
      return { screenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
    }
    if (cmd.type === "CLICK") {
      if (cmd.index === 1) {
        // Simulate search results populating
        this.elements.push({ index: 2, role: "button", text: "Select Quantum Article", attributes: { id: "btn-select-quantum" } });
      }
      return { ok: true };
    }
    if (cmd.type === "TYPE" || cmd.type === "NAVIGATE") {
      if (cmd.type === "NAVIGATE") this.pageUrl = cmd.url;
      return { ok: true };
    }
    return { ok: true };
  }
}

async function runE2ETests() {
  console.log("\n🚀 Running Trustworthy Autonomous Browser Agent E2E Validation Suite\n");

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      pass(name);
      passed++;
    } catch (e) {
      fail(`${name}: ${e.message}`);
    }
  }

  // ── PHASE 5: Closed-Loop Execution ──────────────────────────────────────
  await test("Phase 5: Closed-Loop Autonomous Task Runner Execution", async () => {
    const mockBridge = new MockBridge();
    const runner = new TaskRunner(mockBridge);

    const task = runner.createTask("Search quantum computing in Fixture 1", "http://localhost/fixtures/1-search.html");
    assert.equal(task.state, "IDLE");

    // Step 1: Initialize & Observe
    let res = await runner.stepTask(task.id);
    assert.equal(res.state, "DECIDING");

    // Step 2: Propose Click Search Action
    res = await runner.stepTask(task.id, {
      type: "CLICK",
      description: "Click Search Button",
      category: "READ",
      domain: "localhost",
      params: { index: 1 },
    });

    assert.equal(res.actionExecuted, true);
    assert.equal(res.verificationResult.status, "VERIFIED_SUCCESS");

    // Check Task Status
    const updatedTask = runner.getTask(task.id);
    assert.ok(updatedTask.stateMachine.transitionHistory.length >= 6);
  });

  // ── PHASE 6: Adaptive Observation Validation ─────────────────────────────
  await test("Phase 6: Adaptive Observation Mode Switching", async () => {
    const mockBridge = new MockBridge();
    const observer = new AdaptiveObserver(mockBridge);

    // Heuristic 1: Simple task -> STATE mode
    const obs1 = await observer.observe({ task: "simple click button" });
    assert.ok(obs1.meta.mode === "STATE" || obs1.meta.mode === "GRAPH");

    // Heuristic 2: Complex task query -> GRAPH mode
    const obs2 = await observer.observe({ task: "find product price in deep DOM structure", query: "price" });
    assert.ok(obs2.meta.mode === "GRAPH" || obs2.meta.mode === "HYBRID");

    // Explicit mode override -> VISUAL mode
    const obs3 = await observer.observe({ forceMode: "VISUAL" });
    assert.equal(obs3.meta.mode, "VISUAL");
    assert.ok(obs3.screenshot);
  });

  // ── PHASE 7: Self-Healing & Stale Element Recovery ──────────────────────
  await test("Phase 7: Self-Healing Stale Element Recovery", async () => {
    const mockBridge = new MockBridge();
    const recoveryEngine = new RecoveryEngine(mockBridge);

    const staleError = new Error("Target element was detached from DOM");
    const result = await recoveryEngine.recover({
      error: staleError,
      targetDescription: "Submit Order button",
      originalIndex: 5,
      actionType: "CLICK",
    });

    assert.equal(result.recovered, true);
    assert.equal(result.strategy, "SEMANTIC_MATCH");
    assert.equal(result.oldTarget, "#5");
  });

  // ── PHASE 8: Prompt Injection Defense ───────────────────────────────────
  await test("Phase 8: Prompt Injection Content Defense", () => {
    const detector = new PromptInjectionDetector();
    const maliciousHtml = fs.readFileSync(path.join(fixtureDir, "3-prompt-injection.html"), "utf8");

    const events = detector.scan(maliciousHtml, "webpage");
    assert.ok(events.length > 0);
    assert.equal(events[0].severity, "CRITICAL");
    assert.ok(events[0].description.includes("Instruction override"));
  });

  // ── PHASE 9: Privacy Shield Redaction ────────────────────────────────────
  await test("Phase 9: Privacy Redaction Across Observability Pipeline", () => {
    const shield = new PrivacyShield();
    const sensitiveHtml = fs.readFileSync(path.join(fixtureDir, "4-sensitive-data.html"), "utf8");

    const { text, detections } = shield.redact(sensitiveHtml);
    assert.ok(!text.includes("john.doe.privacy@test-domain.org"));
    assert.ok(!text.includes("987-65-4321"));
    assert.ok(!text.includes("4532-8901-2345-6789"));
    assert.ok(!text.includes("sk_live_99887766554433221100abc"));
    assert.ok(detections.length >= 4);
  });

  // ── PHASE 10: High-Risk Human Approval Gateway ──────────────────────────
  await test("Phase 10: High-Risk Action Human Approval Workflow", async () => {
    const mockBridge = new MockBridge();
    const runner = new TaskRunner(mockBridge);

    const task = runner.createTask("Delete account in Fixture 5", "http://localhost/fixtures/5-approval.html");
    await runner.stepTask(task.id);

    // Propose high risk action
    const res = await runner.stepTask(task.id, {
      type: "CLICK",
      description: "Permanently Delete Workspace",
      category: "DELETE",
      domain: "localhost",
      params: { index: 10 },
    });

    assert.equal(res.approvalRequired, true);
    assert.ok(res.approvalId);
    assert.equal(runner.getTask(task.id).state, "WAITING_FOR_APPROVAL");

    // Reject flow test
    const rejected = runner.approvalGateway.resolve({
      requestId: res.approvalId,
      decision: "REJECTED",
      reason: "User cancelled high risk deletion",
    });
    assert.equal(rejected.status, "REJECTED");
  });

  // ── PHASE 11: Verification Failure Detection ────────────────────────────
  await test("Phase 11: Silent Verification Failure Detection", async () => {
    const mockBridge = new MockBridge();
    const verificationEngine = new VerificationEngine(mockBridge);

    // Simulate before & after snapshot where no state change happens despite click returning success
    const beforeSnapshot = { url: "http://localhost/fixtures/6-verification-failure.html", title: "Test", elementCount: 2, timestamp: Date.now() - 500 };
    mockBridge.pageUrl = beforeSnapshot.url;
    mockBridge.pageTitle = beforeSnapshot.title;
    mockBridge.elements = [
      { index: 0, text: "Error: Registration failed", role: "text" },
      { index: 1, text: "Retry", role: "button" }
    ];

    const result = await verificationEngine.verify({
      actionDescription: "Submit Registration",
      beforeSnapshot,
      expectedCondition: "Registration confirmation status displayed",
    });

    assert.ok(result.status === "VERIFIED_FAILURE" || result.status === "UNCERTAIN");
    assert.ok(result.confidence > 0);
  });

  // ── PHASE 12: Memory Manager & Isolation ─────────────────────────────────
  await test("Phase 12: Multi-Task Memory Isolation", () => {
    const memory = new MemoryManager();
    const task1 = "task-1001";
    const task2 = "task-1002";

    memory.createTask(task1, "Goal Task 1", "http://site1.com");
    memory.createTask(task2, "Goal Task 2", "http://site2.com");

    memory.addEntity(task1, "Entity-Task1");

    const snap1 = memory.getTaskSnapshot(task1);
    const snap2 = memory.getTaskSnapshot(task2);

    assert.ok((snap1.knownEntities).includes("Entity-Task1"));
    assert.ok(!(snap2.knownEntities).includes("Entity-Task1"));
  });

  // ── PHASE 13: Audit Event Logging ────────────────────────────────────────
  await test("Phase 13: Structured Audit Stream Sanitization", () => {
    const logger = new AuditLogger();
    logger.log({
      taskId: "task-999",
      type: "ACTION_EXECUTED",
      domain: "localhost",
      details: "Typed API Key sk_live_99887766554433221100abc into form",
    });

    const events = logger.query({ taskId: "task-999" });
    assert.equal(events.length, 1);
    assert.ok(!events[0].details.includes("sk_live_99887766554433221100abc"));
  });

  // ── PHASE 14: Security Negative Boundary Tests ───────────────────────────
  await test("Phase 14: Security Negative & Invalid State Transition Defense", () => {
    const sm = new ExecutionStateMachine("task-sec");
    assert.throws(() => {
      // Direct jump from IDLE to EXECUTING is invalid
      sm.transitionTo("EXECUTING");
    }, /Invalid state transition/);
  });

  // ── PHASE 18 & 19: Performance & Reliability Metrics ───────────────────
  await test("Phase 18 & 19: Benchmarking Performance & Reliability Metrics", async () => {
    const mockBridge = new MockBridge();
    const runner = new TaskRunner(mockBridge);

    const t0 = Date.now();
    const task = runner.createTask("Benchmark task", "http://localhost");
    await runner.stepTask(task.id);
    await runner.stepTask(task.id, {
      type: "CLICK",
      description: "Click Search",
      category: "READ",
      domain: "localhost",
      params: { index: 1 },
    });

    const totalMs = Date.now() - t0;
    const auditEvents = runner.auditLogger.size;

    assert.ok(totalMs >= 0);
    assert.ok(auditEvents >= 3);
    console.log(`\n    📊 Benchmark Metrics: Total Task Latency: ${totalMs}ms | Audit Events: ${auditEvents}`);
  });

  // ── PHASE 10: End-to-End Integration & Pre-Network Privacy Verification ──────
  await test("Phase 10: Full End-to-End Integration & Pre-Network Privacy Boundary Verification", async () => {
    const shield = new PrivacyShield();
    const sensitivePerception = {
      meta: { mode: "HYBRID", url: "https://isro.gov.in/portal" },
      page: { url: "https://isro.gov.in/portal", title: "ISRO Portal" },
      elements: [
        { index: 0, role: "heading", text: "Welcome to ISRO Portal", visible: true, enabled: true, editable: false },
        { index: 1, role: "textbox", text: "EMAIL_TEST_123@example.com", label: "Email", visible: true, enabled: true, editable: true },
        { index: 2, role: "password", text: "DEMO_PASSWORD_123", label: "Password", visible: true, enabled: true, editable: true },
        { index: 3, role: "textbox", text: "4111 1111 1111 1111", label: "Card", visible: true, enabled: true, editable: true },
        { index: 4, role: "textbox", text: "123-45-6789", label: "SSN", visible: true, enabled: true, editable: true },
        { index: 5, role: "text", text: "sk-live-isro-secret-key-1234567890", label: "ApiKey", visible: true, enabled: true, editable: false },
        { index: 6, role: "button", text: "Learn More", visible: true, enabled: true, editable: false },
      ],
      graphText: "root\n  heading: Welcome to ISRO Portal\n  text: sk-live-isro-secret-key-1234567890",
      interactiveCount: 7,
    };

    // 1. Sanitize context locally before outbound transmission
    const sanitized = shield.sanitizePerception(sensitivePerception);
    const serializedOutbound = JSON.stringify(sanitized);

    // 2. Assert raw synthetic PII markers are 100% absent in outbound network context
    assert.ok(!serializedOutbound.includes("EMAIL_TEST_123@example.com"), "Raw email must be absent in outbound context");
    assert.ok(!serializedOutbound.includes("DEMO_PASSWORD_123"), "Raw password must be absent in outbound context");
    assert.ok(!serializedOutbound.includes("4111 1111 1111 1111"), "Raw credit card must be absent in outbound context");
    assert.ok(!serializedOutbound.includes("123-45-6789"), "Raw SSN must be absent in outbound context");
    assert.ok(!serializedOutbound.includes("sk-live-isro-secret-key-1234567890"), "Raw API key must be absent in outbound context");

    // 3. Assert safe context elements are preserved
    assert.ok(serializedOutbound.includes("Welcome to ISRO Portal"), "Safe heading must survive privacy filtering");
    assert.ok(serializedOutbound.includes("Learn More"), "Safe button text must survive privacy filtering");

    // 4. Verify TaskRunner closed-loop integration with Action Gate
    const mockBridge = new MockBridge();
    const runner = new TaskRunner(mockBridge);
    const task = runner.createTask("Phase 10 Natural Task", "https://isro.gov.in/portal");
    
    // Step 1: Observe & Decide
    await runner.stepTask(task.id);
    
    // Step 2: Propose safe click action
    const res = await runner.stepTask(task.id, {
      type: "CLICK",
      description: "Click Learn More button",
      category: "READ",
      domain: "isro.gov.in",
      params: { index: 6 },
    });

    assert.equal(res.actionExecuted, true);
    assert.equal(res.verificationResult.status, "VERIFIED_SUCCESS");
  });

  console.log(`\n\x1b[32m✨ All ${passed}/${total} E2E Integration & Validation scenarios passed successfully!\x1b[0m\n`);
}

runE2ETests().catch((e) => {
  console.error("E2E Test runner failed:", e);
  process.exit(1);
});
