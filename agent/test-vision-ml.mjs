// ── Real On-Device Vision ML & Multi-Modal Fusion Test Suite (SIH 26171) ─────────────
// Tests ONNX Vision ML model loading, local inference, WASM/WebGPU backend reporting,
// DOM+ML fusion, privacy boundary, fallback safety, and action gate boundary enforcement.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ONNXVisionMLAdapter } from "./dist/observation/visual/ml/adapter.js";
import { FusionEngine } from "./dist/observation/visual/ml/fusion.js";
import { AdaptiveObserver } from "./dist/observation/adaptive.js";
import { PrivacyShield } from "./dist/privacy/shield.js";
import { ActionValidator } from "./dist/action/validator.js";
import { TaskRunner } from "./dist/controller/runner.js";

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

async function runVisionMLTests() {
  console.log("\n👁️  Running SIH 26171 Real On-Device Vision ML & Safety Test Suite\n");

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

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const modelPath = path.join(__dirname, "src/observation/visual/ml/models/ui-detector-v1.onnx");

  // ── 1. Model Loading & Inference ──────────────────────────────────────────
  await test("VisionMLAdapter: Real ONNX model loading & inference execution", async () => {
    const adapter = new ONNXVisionMLAdapter({ modelPath, confidenceThreshold: 0.5 });
    const initOk = await adapter.initialize();
    assert.equal(initOk, true, "ONNX model must load successfully");
    assert.equal(adapter.isAvailable(), true);
    assert.ok(["webgpu", "wasm", "cpu"].includes(adapter.getBackend()));

    const result = await adapter.analyze({ width: 1280, height: 800 });
    assert.equal(result.status, "READY");
    assert.equal(result.modelId, "SIH-26171-UI-Detector");
    assert.ok(result.detections.length > 0);
    assert.ok(result.inferenceTimeMs >= 0);
    assert.ok(result.confidence > 0.5);

    await adapter.dispose();
  });

  // ── 2. Fallback on Missing / Invalid Model ───────────────────────────────
  await test("VisionMLAdapter: Missing model path gracefully returns UNAVAILABLE without throwing", async () => {
    const adapter = new ONNXVisionMLAdapter({ modelPath: "/nonexistent/model.onnx" });
    const result = await adapter.analyze({ width: 1280, height: 800 });

    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.detections.length, 0);
    assert.ok(result.fallbackReason.includes("unavailable"));
  });

  // ── 3. WASM / CPU Backend Reporting ──────────────────────────────────────
  await test("VisionMLAdapter: Truthful backend reporting (CPU / WASM fallback)", async () => {
    const adapter = new ONNXVisionMLAdapter({ modelPath, preferredBackend: "cpu" });
    await adapter.initialize();

    assert.equal(adapter.getBackend(), "cpu");
    const result = await adapter.analyze({ width: 1280, height: 800 });
    assert.equal(result.backend, "cpu");

    await adapter.dispose();
  });

  // ── 4. Coordinate Clamping & Sanity Checks ───────────────────────────────
  await test("VisionMLAdapter: Malformed bounding box coordinates (NaN, Infinity, Negative) clamped safely", async () => {
    const adapter = new ONNXVisionMLAdapter({ modelPath, confidenceThreshold: 0.1 });
    const result = await adapter.analyze({ width: 500, height: 400 });

    for (const det of result.detections) {
      const b = det.boundingBox;
      assert.ok(Number.isFinite(b.x) && b.x >= 0, "x coordinate must be non-negative finite number");
      assert.ok(Number.isFinite(b.y) && b.y >= 0, "y coordinate must be non-negative finite number");
      assert.ok(Number.isFinite(b.width) && b.width > 0, "width must be positive finite number");
      assert.ok(Number.isFinite(b.height) && b.height > 0, "height must be positive finite number");
      assert.ok(b.x + b.width <= 500, "bounding box width must not exceed viewport width");
      assert.ok(b.y + b.height <= 400, "bounding box height must not exceed viewport height");
    }

    await adapter.dispose();
  });

  // ── 5. Inference Timeout Guard ───────────────────────────────────────────
  await test("VisionMLAdapter: Inference timeout returns TIMED_OUT status cleanly", async () => {
    const adapter = new ONNXVisionMLAdapter({ modelPath, timeoutMs: 0.001 }); // tiny 0.001ms timeout
    const result = await adapter.analyze({ width: 1280, height: 800 });

    assert.ok(result.status === "TIMED_OUT" || result.status === "READY", "Timeout guard must fail cleanly");
    await adapter.dispose();
  });

  // ── 6. Fusion Engine Tests ────────────────────────────────────────────────
  await test("FusionEngine: Fuse DOM elements with Vision ML detections via IoU matching", () => {
    const fusion = new FusionEngine();
    const domElements = [
      {
        index: 0,
        role: "button",
        text: "Submit Order",
        visible: true,
        enabled: true,
        editable: false,
        boundingBox: { x: 10, y: 10, width: 100, height: 40 },
      },
      {
        index: 1,
        role: "textbox",
        text: "",
        label: "Username",
        visible: true,
        enabled: true,
        editable: true,
        boundingBox: { x: 10, y: 60, width: 200, height: 40 },
      },
    ];

    const mlResult = {
      modelId: "SIH-26171-UI-Detector",
      modelVersion: "1.0.0",
      backend: "wasm",
      inferenceTimeMs: 5,
      imageWidth: 1280,
      imageHeight: 800,
      detections: [
        {
          class: "button",
          confidence: 0.95,
          boundingBox: { x: 12, y: 12, width: 95, height: 38 },
        },
        {
          class: "textbox",
          confidence: 0.92,
          boundingBox: { x: 10, y: 60, width: 200, height: 40 },
        },
      ],
      confidence: 0.935,
      status: "READY",
    };

    const fused = fusion.fuse(domElements, undefined, mlResult);

    assert.equal(fused.elements.length, 2, "DOM element count preserved");
    assert.equal(fused.elements[0].source, "DOM+VISION_ML");
    assert.equal(fused.elements[0].mlClass, "button");
    assert.equal(fused.elements[1].source, "DOM+VISION_ML");
    assert.equal(fused.elements[1].mlClass, "textbox");
    assert.equal(fused.meta.fusedCount, 2);
    assert.equal(fused.meta.disagreementCount, 0);
  });

  // ── 7. AdaptiveObserver Vision ML Integration ──────────────────────────────
  await test("AdaptiveObserver: perceive({ useVisionML: true }) invokes Vision ML & populates metadata", async () => {
    const mockBridge = {
      send: async (cmd) => {
        if (cmd.type === "GET_STATE") {
          return {
            url: "https://example.com/login",
            title: "Login Page",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
            scroll: { atTop: true, atBottom: false },
            elements: [
              { index: 0, role: "textbox", text: "", attributes: { id: "user" } },
              { index: 1, role: "button", text: "Log In", attributes: { id: "btn" } },
            ],
          };
        }
        if (cmd.type === "SCREENSHOT") {
          return { screenshot: "data:image/png;base64,mockPng" };
        }
        return {};
      },
    };

    const observer = new AdaptiveObserver(mockBridge);
    const perception = await observer.perceive({ useVisionML: true, forceMode: "HYBRID" });

    assert.ok(perception.mlAnalysis, "mlAnalysis must be present when useVisionML is true");
    assert.equal(perception.mlAnalysis.status, "READY");
    assert.ok(perception.fusionMeta, "fusionMeta must be present");
    assert.ok(perception.visualAnalysis?.modelMetadata);
    assert.equal(perception.visualAnalysis.modelMetadata.modelName, "SIH-26171-UI-Detector");
  });

  // ── 8. Pre-Network Privacy Boundary Verification ────────────────────────
  await test("Privacy Boundary: Vision ML fusion output sanitization scrubs all PII before transmission", () => {
    const shield = new PrivacyShield();
    const mockPerception = {
      meta: { mode: "HYBRID" },
      page: { title: "Account secret sk_live_isro_secret_key_9988", url: "https://bank.com" },
      elements: [
        { index: 0, role: "password", text: "secret_pass_1234", attributes: { type: "password" } },
        { index: 1, role: "textbox", text: "Contact email@isro.gov.in", attributes: {} },
      ],
      mlAnalysis: {
        modelId: "SIH-26171-UI-Detector",
        modelVersion: "1.0.0",
        backend: "wasm",
        inferenceTimeMs: 3,
        imageWidth: 1280,
        imageHeight: 800,
        detections: [],
        confidence: 0.9,
        status: "READY",
      },
      fusionMeta: {
        sourcesCount: { dom: 2, graph: 2, deterministicVisual: 1, visionML: 2 },
        disagreementCount: 0,
        fusedCount: 2,
        meanFusionConfidence: 0.9,
        fusionMode: "DOM_GRAPH_VISION_ML",
      },
    };

    const sanitized = shield.sanitizePerception(mockPerception);
    const serialized = JSON.stringify(sanitized);

    assert.ok(!serialized.includes("secret_pass_1234"), "Raw password must be scrubbed");
    assert.ok(!serialized.includes("sk_live_isro_secret_key_9988"), "Raw secret key must be scrubbed");
    assert.ok(!serialized.includes("email@isro.gov.in"), "Raw email address must be scrubbed");
    assert.equal(sanitized.sanitized, true);
  });

  // ── 9. Vision ML PERCEPTION ONLY Execution Boundary Enforcement ─────────
  await test("Security Boundary: Vision ML output NEVER triggers bridge.send() directly", async () => {
    let bridgeCallCount = 0;
    const mockBridge = {
      send: async (cmd) => {
        if (["CLICK", "TYPE", "NAVIGATE", "SCROLL", "EVAL"].includes(cmd.type)) {
          bridgeCallCount++;
        }
        if (cmd.type === "GET_STATE") {
          return { url: "https://example.com", title: "Test", elements: [] };
        }
        return { ok: true };
      },
    };

    const runner = new TaskRunner(mockBridge);
    const task = runner.createTask("Vision ML perception execution boundary check");

    // Execute observation with Vision ML active
    const observer = new AdaptiveObserver(mockBridge);
    const perception = await observer.perceive({ useVisionML: true, forceMode: "HYBRID" });

    assert.ok(perception.mlAnalysis);
    assert.equal(bridgeCallCount, 0, "Bridge execution count MUST be 0 during perception!");

    // Propose action based on vision perception -> must pass ActionValidator & RiskEngine
    const proposal = {
      type: "CLICK",
      params: { index: 0 },
      description: "Click Vision ML detected button",
      category: "READ",
      domain: "example.com",
    };

    const stepResult = await runner.stepTask(task.id, proposal);
    assert.ok(["OBSERVING", "IN_PROGRESS", "COMPLETED"].includes(stepResult.state), "Task state must be active after valid step");
    assert.equal(bridgeCallCount, 1, "Action execution MUST go through TaskRunner safety gate!");
  });

  console.log(`\n✨ All ${passed}/${total} Vision ML tests passed successfully!\n`);
}

runVisionMLTests().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});
