// ── LLM Agent & Provider Types ────────────────────────────────────────────────
// Defines interface contracts for LLM providers, structured output parsing,
// autonomous agent loop steps, and multi-step execution results.

import type { ActionProposal } from "./action.js";
import type { UnifiedPerceptionResult } from "./observation.js";

export type LLMProviderType = "openai" | "ollama" | "mock" | "custom";

export interface LLMProviderConfig {
  enabled: boolean;
  provider: LLMProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMStepHistoryItem {
  step: number;
  thought: string;
  actionProposed?: ActionProposal;
  actionExecuted?: boolean;
  verificationSuccess?: boolean;
  observationSummary?: string;
  timestamp: number;
}

export interface LLMTaskRequest {
  taskId: string;
  userPrompt: string;
  perception: UnifiedPerceptionResult;
  history: LLMStepHistoryItem[];
  maxSteps?: number;
}

export interface LLMActionDecision {
  status: "CONTINUE" | "DONE" | "FAIL" | "NEED_INFO";
  thought: string;
  action: ActionProposal | null;
  finalAnswer?: string;
  confidence: number;
  requiresApproval?: boolean;
}

export interface LLMTaskResult {
  taskId: string;
  status: "SUCCESS" | "FAILED" | "APPROVAL_REQUIRED" | "BLOCKED_SECURITY" | "MAX_STEPS_EXCEEDED";
  userPrompt: string;
  finalAnswer?: string;
  stepsExecuted: number;
  history: LLMStepHistoryItem[];
  privacySanitized: boolean;
  totalLatencyMs: number;
  llmLatencyMs: number;
  error?: string;
}

export interface LLMProviderMetadata {
  name: string;
  model: string;
  available: boolean;
  isMock: boolean;
}
