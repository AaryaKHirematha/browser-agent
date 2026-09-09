#!/usr/bin/env node
// Long-running server process. Hosts:
//   • the WebSocket bridge the extension connects to        (ws://localhost:8777)
//   • a JSON-RPC 2.0 endpoint any agent/language can call    (http://localhost:8778/rpc)
//   • discovery + health endpoints                           (/methods, /health)
//   • dashboard (GET /dashboard)
//
// The MCP wrapper (mcp.ts) is a separate stdio process that just forwards tool
// calls to /rpc here, so MCP clients and raw HTTP clients share one browser.

import http from "node:http";
import { z } from "zod";
import { Bridge } from "./bridge.js";
import { METHODS, METHOD_MAP, SERVER_METHODS, SERVER_METHOD_MAP } from "./methods.js";
import { isAuthenticated } from "./mcp/auth.js";
import { mcpSessionManager } from "./mcp/session.js";
import { handleSseConnect, handleSseMessage } from "./mcp/router.js";

// ── Intelligence Modules ────────────────────────────────────────────────────
import { AdaptiveObserver } from "./observation/adaptive.js";
import { RiskEngine } from "./risk/engine.js";
import { PolicyEngine } from "./policy/engine.js";
import { ApprovalGateway } from "./approval/gateway.js";
import { VerificationEngine, type PageSnapshot } from "./verification/engine.js";
import { RecoveryEngine } from "./recovery/engine.js";
import { PrivacyShield } from "./privacy/shield.js";
import { MemoryManager, generateTaskId } from "./memory/manager.js";
import { AuditLogger } from "./audit/logger.js";
import { PromptInjectionDetector } from "./security/injection.js";
import { TaskRunner } from "./controller/runner.js";
import { ActionValidator } from "./action/validator.js";
import { AutonomousLLMAgent } from "./llm/agent-loop.js";
import type { ActionCategory, ActionProposal, ActionType } from "./types/action.js";
import type { RiskLevel } from "./types/risk.js";
import type { PolicyRule } from "./types/policy.js";
import type { AuditEventType } from "./types/audit.js";

export const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8777);
export const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8778);

// ── Initialize modules ──────────────────────────────────────────────────────

const bridge = new Bridge(BRIDGE_PORT);
const observer = new AdaptiveObserver(bridge);
const actionValidator = new ActionValidator();
const riskEngine = new RiskEngine();
const policyEngine = new PolicyEngine();
const approvalGateway = new ApprovalGateway();
const verificationEngine = new VerificationEngine(bridge);
const recoveryEngine = new RecoveryEngine(bridge);
const privacyShield = new PrivacyShield();
const memoryManager = new MemoryManager();
const auditLogger = new AuditLogger();
const injectionDetector = new PromptInjectionDetector();
const taskRunner = new TaskRunner(bridge);

// Store the last verification snapshot for browser_verify_action
let lastSnapshot: PageSnapshot | null = null;

// ── JSON-RPC Dispatch ───────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

async function dispatch(req: RpcRequest) {
  const id = req.id ?? null;
  const methodName = req.method ?? "";

  // 1. Try extension-bridged methods (existing + browser_screenshot)
  const bridgeMethod = METHOD_MAP.get(methodName);
  if (bridgeMethod) {
    const parsed = z.object(bridgeMethod.shape).safeParse(req.params ?? {});
    if (!parsed.success) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      };
    }
    try {
      const tabId = parsed.data.tabId as number | undefined;

      // ── PHASE 8 UNIFIED ACTION SAFETY GATE ──────────────────────────────
      const actionMap: Record<string, { type: ActionType; category: ActionCategory }> = {
        browser_click: { type: "CLICK", category: "WRITE" },
        browser_type: { type: "TYPE", category: "WRITE" },
        browser_scroll: { type: "SCROLL", category: "READ" },
        browser_scroll_to: { type: "SCROLL_TO", category: "READ" },
        browser_navigate: { type: "NAVIGATE", category: "NAVIGATE" },
        browser_eval: { type: "EVAL", category: "WRITE" },
      };

      if (methodName in actionMap) {
        const { type: actionType, category: defaultCategory } = actionMap[methodName];
        let category = defaultCategory;

        if (methodName === "browser_type" && parsed.data.text && typeof parsed.data.text === "string") {
          if (privacyShield.isSensitive(parsed.data.text) || /password|secret|key|pwd/i.test(JSON.stringify(parsed.data))) {
            category = "ACCOUNT_CHANGE";
          }
        }

        const proposal: ActionProposal = {
          type: actionType,
          index: parsed.data.index as number | undefined,
          params: parsed.data,
          description: `Direct action ${methodName}`,
          category,
          domain: "active-tab",
        };

        // 1. Structural Action Validation
        const validation = actionValidator.validate(proposal);
        if (!validation.allowed) {
          auditLogger.log({
            type: "ACTION_FAILED",
            taskId: memoryManager.activeTaskId,
            action: methodName,
            details: `Action validation failed: ${validation.reason}`,
            result: "FAILURE",
          });
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: `ACTION_VALIDATION_FAILED: ${validation.reason}` },
          };
        }

        // 2. Risk Assessment
        const risk = riskEngine.assess(proposal);

        // 3. Policy Check
        const policyDecision = policyEngine.evaluate(proposal, risk);
        if (policyDecision.action === "DENY") {
          auditLogger.log({
            type: "POLICY_EVALUATED",
            taskId: memoryManager.activeTaskId,
            action: methodName,
            details: `Policy denied action: ${policyDecision.reason}`,
            result: "FAILURE",
          });
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: `POLICY_DENIED: ${policyDecision.reason}` },
          };
        }

        // 4. Human Approval Gate
        if (policyDecision.action === "REQUIRE_APPROVAL" || risk.approvalRequired) {
          const providedApprovalId = parsed.data.approvalId as string | undefined;
          if (providedApprovalId) {
            const req = approvalGateway.get(providedApprovalId);
            if (!req || req.status !== "APPROVED") {
              return {
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32000,
                  message: `APPROVAL_REQUIRED: Approval '${providedApprovalId}' is invalid, expired, or not approved.`,
                },
              };
            }
            // Bind approval to exact action/target
            const expectedTarget = proposal.description;
            if (req.action !== expectedTarget && req.target !== expectedTarget) {
              return {
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32000,
                  message: `APPROVAL_MISMATCH: Approval '${providedApprovalId}' was issued for '${req.action}', not '${expectedTarget}'.`,
                },
              };
            }
            // Single-use consumption: mark as consumed to prevent replay
            (req as any).status = "CONSUMED";
          } else {
            const appReq = approvalGateway.request({
              action: proposal.description,
              target: proposal.description,
              domain: proposal.domain,
              riskLevel: risk.level,
              reason: policyDecision.reason || risk.reason,
            });

            auditLogger.log({
              type: "APPROVAL_REQUESTED",
              taskId: memoryManager.activeTaskId,
              action: methodName,
              details: `Approval required (${appReq.id}): ${risk.reason}`,
              riskLevel: risk.level,
            });

            return {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32000,
                message: `APPROVAL_REQUIRED: Action ${methodName} requires explicit human approval (${appReq.id})`,
              },
            };
          }
        }
      }

      // Take a pre-action snapshot for verification (for mutating actions)
      if (["browser_click", "browser_type", "browser_navigate"].includes(methodName)) {
        try { lastSnapshot = await verificationEngine.snapshot(); } catch { /* best effort */ }
      }

      let result = await bridge.send(bridgeMethod.toCommand(parsed.data), tabId);

      // Preprocess browser_screenshot through local Privacy Firewall before AI exposure
      if (methodName === "browser_screenshot" && result && typeof result === "object" && "screenshot" in result) {
        const rawObj = result as { screenshot?: string; width?: number; height?: number; ok?: boolean };
        if (rawObj.screenshot) {
          try {
            const perception = await observer.perceive({ forceMode: "VISUAL", includeScreenshot: false });
            const sanitizedPerception = privacyShield.sanitizePerception({
              ...perception,
              screenshot: rawObj.screenshot,
            });
            if (sanitizedPerception.screenshot) {
              result = {
                ok: true,
                screenshot: sanitizedPerception.screenshot,
                width: rawObj.width,
                height: rawObj.height,
                sanitized: true,
                protectedRegions: sanitizedPerception.sensitiveDataSummary?.redactedCount ?? 0,
              };
            } else {
              return {
                jsonrpc: "2.0",
                id,
                error: { code: -32000, message: "SCREENSHOT_PRIVACY_PROCESSING_FAILED" },
              };
            }
          } catch {
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: "SCREENSHOT_PRIVACY_PROCESSING_FAILED" },
            };
          }
        }
      }

      // Audit bridge actions
      auditLogger.log({
        type: "ACTION_EXECUTED",
        taskId: memoryManager.activeTaskId,
        action: methodName,
        target: JSON.stringify(parsed.data).slice(0, 200),
        result: "SUCCESS",
      });

      if (memoryManager.activeTaskId) {
        memoryManager.recordAction(memoryManager.activeTaskId, {
          actionType: methodName,
          description: `Executed ${methodName}`,
          success: true,
          timestamp: Date.now()
        });
      }

      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      auditLogger.log({
        type: "ACTION_FAILED",
        taskId: memoryManager.activeTaskId,
        action: methodName,
        details: e instanceof Error ? e.message : String(e),
        result: "FAILURE",
      });
      return { jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } };
    }
  }

  // 2. Try server-side methods (new intelligence tools)
  const serverMethod = SERVER_METHOD_MAP.get(methodName);
  if (serverMethod) {
    const parsed = z.object(serverMethod.shape).safeParse(req.params ?? {});
    if (!parsed.success) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      };
    }
    try {
      const result = await dispatchServerMethod(methodName, parsed.data);
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${methodName}` } };
}

// ── MCP Session Dispatch ────────────────────────────────────────────────────
export async function dispatchForMcp(method: string, params: Record<string, unknown>, sessionId: string) {
  const boundTaskId = mcpSessionManager.getTaskForSession(sessionId);
  if (!params.taskId && boundTaskId) {
    params.taskId = boundTaskId;
  }

  const req: RpcRequest = { jsonrpc: "2.0", id: `mcp-${Date.now()}`, method, params };
  const prevTaskId = memoryManager.activeTaskId;
  
  if (boundTaskId) {
    memoryManager.setActiveTask(boundTaskId);
  }

  try {
    const res = await dispatch(req);
    
    if (method === "browser_create_task" && res.result && typeof res.result === "object" && "id" in res.result) {
      mcpSessionManager.bindTaskToSession(sessionId, (res.result as { id: string }).id);
    }
    
    if (res.error) throw new Error(res.error.message);
    return res.result;
  } finally {
    // Cast to any to allow undefined if prevTaskId was undefined
    memoryManager.setActiveTask(prevTaskId as any);
  }
}


// ── Server-Side Method Handlers ─────────────────────────────────────────────

async function dispatchServerMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    // ── Adaptive Observation ──────────────────────────────────────────────
    case "browser_observe": {
      const obs = await observer.observe({
        task: params.task as string | undefined,
        forceMode: params.mode as any,
        query: params.query as string | undefined,
        maxNodes: params.maxNodes as number | undefined,
        includeScreenshot: params.includeScreenshot as boolean | undefined,
      });

      // Run privacy shield on the observation
      const obsRecord = obs as unknown as Record<string, unknown>;
      const redactionResult = privacyShield.redactObservation(obsRecord);

      // Run prompt injection detection
      const injections = injectionDetector.scanObservation(obs);
      if (injections.length > 0) {
        auditLogger.log({
          type: "PROMPT_INJECTION_DETECTED",
          taskId: memoryManager.activeTaskId,
          url: obs.page.url,
          domain: extractDomain(obs.page.url),
          details: injections.map((i) => i.description).join("; "),
          severity: injectionDetector.hasCriticalInjection(injections) ? "CRITICAL" : "WARNING",
        });
      }

      // Audit the observation
      auditLogger.log({
        type: "OBSERVATION",
        taskId: memoryManager.activeTaskId,
        url: obs.page.url,
        domain: extractDomain(obs.page.url),
        details: `Mode: ${obs.meta.mode}, Elements: ${obs.interactiveCount}, Size: ${obs.meta.sizeChars} chars`,
      });

      // Take snapshot for later verification
      try { lastSnapshot = await verificationEngine.snapshot(); } catch { /* best effort */ }

      return {
        ...obs,
        redaction: redactionResult.modified ? {
          detectionsCount: redactionResult.detectionsCount,
          types: redactionResult.detections.map((d) => d.type),
        } : undefined,
        security: injections.length > 0 ? {
          injectionWarnings: injections.map((i) => ({
            severity: i.severity,
            description: i.description,
          })),
        } : undefined,
      };
    }

    // ── Risk Assessment ───────────────────────────────────────────────────
    case "browser_assess_action": {
      const assessment = riskEngine.assess({
        type: (params.action as string).toUpperCase() as any,
        description: params.description as string,
        category: params.category as ActionCategory,
        domain: params.domain as string || "",
        index: params.index as number | undefined,
        params: {},
      });

      auditLogger.log({
        type: "RISK_ASSESSED",
        taskId: memoryManager.activeTaskId,
        action: params.description as string,
        riskLevel: assessment.level,
        details: assessment.reason,
      });

      return assessment;
    }

    // ── Approval Request ──────────────────────────────────────────────────
    case "browser_request_approval": {
      const request = approvalGateway.request({
        action: params.action as string,
        target: params.target as string,
        domain: params.domain as string,
        riskLevel: params.riskLevel as RiskLevel,
        reason: params.reason as string,
        affectedData: params.affectedData as string | undefined,
      });

      auditLogger.log({
        type: "APPROVAL_REQUESTED",
        taskId: memoryManager.activeTaskId,
        action: params.action as string,
        domain: params.domain as string,
        riskLevel: params.riskLevel as RiskLevel,
        details: `Approval request ${request.id}: ${params.reason}`,
      });

      return request;
    }

    // ── Approval Resolution ───────────────────────────────────────────────
    case "browser_resolve_approval": {
      const resolved = approvalGateway.resolve({
        requestId: params.requestId as string,
        decision: params.decision as "APPROVED" | "REJECTED",
        reason: params.reason as string | undefined,
      });

      auditLogger.log({
        type: "APPROVAL_RESOLVED",
        taskId: memoryManager.activeTaskId,
        approvalStatus: resolved.status === "APPROVED" ? "APPROVED" : "REJECTED",
        details: `Request ${resolved.id} ${resolved.status}`,
      });

      if (memoryManager.activeTaskId) {
        memoryManager.recordApproval(memoryManager.activeTaskId, {
          id: params.requestId as string,
          action: "unknown",
          target: "unknown",
          domain: "unknown",
          riskLevel: "HIGH",
          reason: "unknown",
          status: resolved.status === "APPROVED" ? "APPROVED" : "REJECTED",
          createdAt: Date.now(),
          expiresAt: Date.now() + 60000
        });
      }

      return resolved;
    }

    // ── Action Verification ───────────────────────────────────────────────
    case "browser_verify_action": {
      const snapshot = lastSnapshot ?? await verificationEngine.snapshot();
      const result = await verificationEngine.verify({
        actionDescription: params.actionDescription as string,
        beforeSnapshot: snapshot,
        expectedCondition: params.expectedCondition as string | undefined,
      });

      auditLogger.log({
        type: "VERIFICATION_COMPLETED",
        taskId: memoryManager.activeTaskId,
        action: params.actionDescription as string,
        verificationStatus: result.status,
        details: result.summary,
      });

      // Record in memory if there's an active task
      if (memoryManager.activeTaskId) {
        memoryManager.recordVerification(memoryManager.activeTaskId, result);
      }

      return result;
    }

    // ── Task State ────────────────────────────────────────────────────────
    case "browser_get_task_state": {
      const taskId = (params.taskId as string) || memoryManager.activeTaskId;
      if (!taskId) return { error: "No active task. Start a task first." };
      const snapshot = memoryManager.getTaskSnapshot(taskId);
      return snapshot ?? { error: `No task found with ID: ${taskId}` };
    }

    // ── Audit Log ─────────────────────────────────────────────────────────
    case "browser_get_audit": {
      return auditLogger.query({
        taskId: params.taskId as string | undefined,
        types: params.types as AuditEventType[] | undefined,
        limit: (params.limit as number) ?? 50,
        since: params.since as number | undefined,
      });
    }

    // ── Policy Get ────────────────────────────────────────────────────────
    case "browser_get_policy": {
      return policyEngine.getConfig();
    }

    // ── Policy Set ────────────────────────────────────────────────────────
    case "browser_set_policy": {
      const domain = params.domain as string;
      const rules = (params.rules as Array<{ actionCategory: string; decision: string; description?: string }>) ?? [];

      policyEngine.setDomainPolicy({
        domain,
        trusted: (params.trusted as boolean) ?? false,
        rules: rules.map((r) => ({
          domain,
          actionCategory: r.actionCategory as ActionCategory,
          decision: r.decision as "ALLOW" | "DENY" | "REQUIRE_APPROVAL",
          description: r.description,
        })),
      });

      auditLogger.log({
        type: "POLICY_EVALUATED",
        taskId: memoryManager.activeTaskId,
        domain,
        details: `Policy updated for ${domain}: ${rules.length} rules`,
      });

      return { ok: true, domain, rulesCount: rules.length };
    }

    // ── Cancel Task ───────────────────────────────────────────────────────
    case "browser_cancel_task": {
      const taskId = (params.taskId as string) || memoryManager.activeTaskId;
      if (!taskId) return { error: "No active task to cancel." };
      const ok = taskRunner.cancelTask(taskId);
      memoryManager.deleteTask(taskId);
      return { ok, taskId, status: "CANCELLED" };
    }

    // ── Create Task ───────────────────────────────────────────────────────
    case "browser_create_task": {
      const goal = params.goal as string;
      const startUrl = params.startUrl as string | undefined;
      const record = taskRunner.createTask(goal, startUrl);
      
      memoryManager.createTask(record.id, goal, startUrl ?? "about:blank");
      memoryManager.setActiveTask(record.id);
      
      return record;
    }

    // ── Run / Step Task ───────────────────────────────────────────────────
    case "browser_run_task": {
      const taskId = params.taskId as string;
      const actionProposal = params.actionProposal as any;
      const res = await taskRunner.stepTask(taskId, actionProposal);
      return res;
    }

    // ── Get Task ──────────────────────────────────────────────────────────
    case "browser_get_task": {
      const taskId = params.taskId as string;
      const record = taskRunner.getTask(taskId);
      if (!record) return { error: `Task ${taskId} not found` };
      return {
        id: record.id,
        goal: record.goal,
        state: record.state,
        currentStepIndex: record.currentStepIndex,
        stepsCount: record.steps.length,
        transitionHistory: record.stateMachine.transitionHistory,
      };
    }

    // ── Pause Task ────────────────────────────────────────────────────────
    case "browser_pause_task": {
      const taskId = params.taskId as string;
      const ok = taskRunner.pauseTask(taskId);
      return { ok, taskId };
    }

    // ── Resume Task ───────────────────────────────────────────────────────
    case "browser_resume_task": {
      const taskId = params.taskId as string;
      const ok = taskRunner.resumeTask(taskId);
      return { ok, taskId };
    }

    // ── Record Recovery ───────────────────────────────────────────────────
    case "browser_record_recovery": {
      const taskId = (params.taskId as string) || memoryManager.activeTaskId;
      if (taskId) {
        memoryManager.recordRecovery(taskId, {
          recovered: true,
          strategy: "SEMANTIC_MATCH",
          failureReason: "Element not found",
          confidence: 0.9,
          retryCount: 1,
          durationMs: 50
        });
      }
      return { ok: true };
    }

    // ── Run LLM Autonomous Agent Task ──────────────────────────────────────
    case "browser_run_llm_task": {
      const prompt = params.prompt as string;
      const maxSteps = (params.maxSteps as number) ?? 10;
      const llmAgent = new AutonomousLLMAgent(bridge);
      return await llmAgent.runTask(prompt, maxSteps);
    }

    default:
      throw new Error(`Unhandled server method: ${method}`);
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  });
  res.end(json);
}

const ALL_METHODS = [...METHODS, ...SERVER_METHODS];

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, {
      ok: true,
      extensionConnected: bridge.connected,
      mcpEnabled: true,
      mcpActiveSessions: mcpSessionManager.getActiveSessionCount(),
      llmEnabled: process.env.LLM_ENABLED === "true",
      llmProvider: process.env.LLM_PROVIDER || "mock",
      modules: {
        observation: true,
        risk: true,
        policy: true,
        approval: true,
        verification: true,
        recovery: true,
        privacy: true,
        memory: true,
        audit: true,
        security: true,
        llm: true,
      },
      pendingApprovals: approvalGateway.getPending().length,
      activeTask: memoryManager.activeTaskId ?? null,
      auditEvents: auditLogger.size,
    });
  }

  if (req.method === "GET" && req.url === "/methods") {
    return send(res, 200, {
      methods: ALL_METHODS.map((m) => ({
        name: m.name,
        description: m.description,
        params: Object.keys(m.shape),
      })),
    });
  }

  // ── Remote MCP Endpoints ────────────────────────────────────────────────
  const urlObj = req.url ? new URL(req.url, `http://${req.headers.host || 'localhost'}`) : null;
  if (urlObj && urlObj.pathname === "/mcp") {
    if (!isAuthenticated(req)) {
      return send(res, 401, { error: "Unauthorized" });
    }
    if (req.method === "GET") {
      handleSseConnect(req, res, dispatchForMcp).catch((e) => {
        console.error("[mcp] SSE connect error:", e);
        if (!res.headersSent) send(res, 500, { error: "Internal Server Error" });
      });
      return;
    }
  }

  if (urlObj && urlObj.pathname === "/mcp/message") {
    if (req.method === "POST") {
      handleSseMessage(req, res).catch((e) => {
        console.error("[mcp] SSE message error:", e);
        if (!res.headersSent) send(res, 500, { error: "Internal Server Error" });
      });
      return;
    }
  }

  // ── Dashboard ───────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/dashboard") {
    const html = generateDashboardHtml();
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  // ── Dashboard API ───────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/dashboard/state") {
    return send(res, 200, {
      connected: bridge.connected,
      activeTask: memoryManager.activeTaskId
        ? memoryManager.getTaskSnapshot(memoryManager.activeTaskId)
        : null,
      mcpSessions: mcpSessionManager.getActiveSessionCount(),
      pendingApprovals: approvalGateway.getPending(),
      recentAudit: auditLogger.query({ limit: 20 }),
      policyConfig: policyEngine.getConfig(),
    });
  }

  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let payload: RpcRequest | RpcRequest[];
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      }
      // Support JSON-RPC batches.
      const result = Array.isArray(payload)
        ? await Promise.all(payload.map(dispatch))
        : await dispatch(payload);
      return send(res, 200, result);
    });
    return;
  }

  send(res, 404, { error: "not found" });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // Another bridge already owns this port — defer to it and exit cleanly so
    // an auto-spawn race (two MCP clients starting at once) doesn't crash.
    console.error(`[rpc] http port ${HTTP_PORT} already in use; another bridge is running — exiting.`);
    process.exit(0);
  }
  console.error("[rpc] http server error:", err.message);
});

server.listen(HTTP_PORT, () => {
  console.error(`[rpc]    JSON-RPC on http://localhost:${HTTP_PORT}/rpc  (GET /methods, /health, /dashboard)`);
  console.error(`[rpc]    Trustworthy Autonomous Browser Agent — all modules loaded`);
});

// ── Dashboard HTML ──────────────────────────────────────────────────────────

function generateDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Trustworthy Browser Agent — Dashboard</title>
<style>
  :root {
    --bg: #0f0f13;
    --surface: #1a1a23;
    --border: #2a2a38;
    --text: #e0e0e8;
    --text-dim: #8888a0;
    --accent: #6366f1;
    --accent2: #8b5cf6;
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
    --orange: #f97316;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  h1 { font-size: 1.5rem; background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 12px; }
  .stat { font-size: 2rem; font-weight: 700; }
  .stat.green { color: var(--green); }
  .stat.yellow { color: var(--yellow); }
  .stat.red { color: var(--red); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
  .badge.low { background: #22c55e22; color: var(--green); }
  .badge.medium { background: #eab30822; color: var(--yellow); }
  .badge.high { background: #f9731622; color: var(--orange); }
  .badge.critical { background: #ef444422; color: var(--red); }
  .badge.connected { background: #22c55e22; color: var(--green); }
  .badge.disconnected { background: #ef444422; color: var(--red); }
  .log { max-height: 400px; overflow-y: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; line-height: 1.6; }
  .log-entry { padding: 4px 0; border-bottom: 1px solid var(--border); }
  .log-time { color: var(--text-dim); margin-right: 8px; }
  .log-type { color: var(--accent); margin-right: 8px; }
  .approval-card { background: #ef444411; border: 1px solid var(--red); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
  .approval-card h3 { font-size: 0.9rem; color: var(--red); margin-bottom: 4px; }
  .btn { padding: 6px 16px; border: none; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; margin-right: 8px; }
  .btn-approve { background: var(--green); color: #000; }
  .btn-reject { background: var(--red); color: #fff; }
  #status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  #status-dot.on { background: var(--green); box-shadow: 0 0 8px var(--green); }
  #status-dot.off { background: var(--red); }
</style>
</head>
<body>
<h1>🛡️ Trustworthy Autonomous Browser Agent</h1>
<div class="grid">
  <div class="card">
    <h2>Connection</h2>
    <div><span id="status-dot" class="off"></span><span id="conn-status">Checking...</span></div>
    <div style="margin-top: 8px; color: var(--text-dim); font-size: 0.85rem;">
      <div>Active Task: <span id="active-task">—</span></div>
      <div>Audit Events: <span id="audit-count">0</span></div>
      <div>MCP Sessions: <span id="mcp-count">0</span></div>
    </div>
  </div>
  <div class="card">
    <h2>Pending Approvals</h2>
    <div id="approvals"><span style="color: var(--text-dim)">None</span></div>
  </div>
  <div class="card" style="grid-column: span 2;">
    <h2>Audit Log</h2>
    <div class="log" id="audit-log"><span style="color: var(--text-dim)">Loading...</span></div>
  </div>
</div>
<script>
async function refresh() {
  try {
    const r = await fetch('/dashboard/state');
    const s = await r.json();
    // Connection
    const dot = document.getElementById('status-dot');
    const conn = document.getElementById('conn-status');
    dot.className = s.connected ? 'on' : 'off';
    conn.textContent = s.connected ? 'Extension Connected' : 'Disconnected';
    // Task
    document.getElementById('active-task').textContent = s.activeTask?.taskId ?? '—';
    document.getElementById('audit-count').textContent = s.recentAudit?.length ?? 0;
    document.getElementById('mcp-count').textContent = s.mcpSessions ?? 0;
    // Approvals
    const apDiv = document.getElementById('approvals');
    if (s.pendingApprovals?.length) {
      apDiv.innerHTML = s.pendingApprovals.map(a => \`
        <div class="approval-card">
          <h3>⚠️ \${a.action}</h3>
          <div>Target: \${a.target}</div>
          <div>Domain: \${a.domain}</div>
          <div>Risk: <span class="badge \${a.riskLevel.toLowerCase()}">\${a.riskLevel}</span></div>
          <div>Reason: \${a.reason}</div>
          <div style="margin-top: 8px;">
            <button class="btn btn-approve" onclick="resolve('\${a.id}','APPROVED')">✓ Approve</button>
            <button class="btn btn-reject" onclick="resolve('\${a.id}','REJECTED')">✗ Reject</button>
          </div>
        </div>\`).join('');
    } else {
      apDiv.innerHTML = '<span style="color: var(--text-dim)">No pending approvals</span>';
    }
    // Audit
    const logDiv = document.getElementById('audit-log');
    if (s.recentAudit?.length) {
      logDiv.innerHTML = s.recentAudit.reverse().map(e => {
        const t = new Date(e.timestamp).toLocaleTimeString();
        return \`<div class="log-entry"><span class="log-time">\${t}</span><span class="log-type">\${e.type}</span>\${e.action||''} \${e.details||''}</div>\`;
      }).join('');
    } else {
      logDiv.innerHTML = '<span style="color: var(--text-dim)">No events yet</span>';
    }
  } catch(e) { console.error('Dashboard refresh failed:', e); }
}
async function resolve(id, decision) {
  await fetch('/rpc', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'browser_resolve_approval',params:{requestId:id,decision}})});
  refresh();
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
