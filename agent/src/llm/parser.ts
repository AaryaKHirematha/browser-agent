// ── LLM Structured Output Parser ──────────────────────────────────────────────
// Parses raw model text into strict, machine-readable LLMActionDecision objects.
// Enforces action schema validation and prevents execution of raw unstructured text.

import type { ActionProposal, ActionCategory, ActionType } from "../types/action.js";
import type { LLMActionDecision } from "../types/llm.js";

const VALID_ACTION_TYPES: ActionType[] = [
  "CLICK",
  "TYPE",
  "SCROLL",
  "SCROLL_TO",
  "NAVIGATE",
  "EVAL",
  "SELECT",
  "HIGHLIGHT",
  "CLEAR_HIGHLIGHT",
  "WAIT",
  "CUSTOM",
];

const ACTION_CATEGORY_MAP: Record<ActionType, ActionCategory> = {
  CLICK: "WRITE",
  TYPE: "WRITE",
  SCROLL: "READ",
  SCROLL_TO: "READ",
  NAVIGATE: "NAVIGATE",
  EVAL: "WRITE",
  SELECT: "WRITE",
  HIGHLIGHT: "READ",
  CLEAR_HIGHLIGHT: "READ",
  WAIT: "READ",
  CUSTOM: "READ",
};

export class LLMParser {
  /** Parse raw LLM output text into a validated LLMActionDecision. */
  parse(rawText: string, domain = "unknown"): LLMActionDecision {
    if (!rawText || typeof rawText !== "string") {
      return this.failDecision("Empty or invalid LLM response");
    }

    let jsonString = rawText.trim();
    const markdownMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(jsonString);
    if (markdownMatch && markdownMatch[1]) {
      jsonString = markdownMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonString);
      return this.validateDecisionObject(parsed, domain);
    } catch (err) {
      const jsonObjectMatch = /\{[\s\S]*\}/.exec(rawText);
      if (jsonObjectMatch) {
        try {
          const parsed = JSON.parse(jsonObjectMatch[0]);
          return this.validateDecisionObject(parsed, domain);
        } catch {
          // Fall through
        }
      }
      return this.failDecision(`Failed to parse LLM JSON output: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private validateDecisionObject(obj: Record<string, unknown>, domain: string): LLMActionDecision {
    const thought = typeof obj.thought === "string" ? obj.thought : "No thought provided";
    const confidence = typeof obj.confidence === "number" ? Math.min(1, Math.max(0, obj.confidence)) : 0.8;
    const status = (typeof obj.status === "string" ? obj.status.toUpperCase() : "CONTINUE") as LLMActionDecision["status"];
    const finalAnswer = typeof obj.finalAnswer === "string" ? obj.finalAnswer : typeof obj.answer === "string" ? (obj.answer as string) : undefined;

    if (status === "DONE") {
      return {
        status: "DONE",
        thought,
        action: null,
        finalAnswer: finalAnswer ?? thought,
        confidence,
      };
    }

    if (status === "FAIL" || status === "NEED_INFO") {
      return {
        status,
        thought,
        action: null,
        finalAnswer,
        confidence,
      };
    }

    const rawAction = (obj.action && typeof obj.action === "object" ? obj.action : obj) as Record<string, unknown>;
    const actionTypeRaw = (typeof rawAction.action === "string" ? rawAction.action : typeof rawAction.type === "string" ? rawAction.type : "CLICK").toUpperCase() as ActionType;

    if (!VALID_ACTION_TYPES.includes(actionTypeRaw)) {
      return this.failDecision(`Unsupported action type "${actionTypeRaw}" proposed by LLM`);
    }

    const category: ActionCategory = (typeof rawAction.category === "string" ? rawAction.category.toUpperCase() : ACTION_CATEGORY_MAP[actionTypeRaw]) as ActionCategory;
    const index = typeof rawAction.index === "number" ? rawAction.index : typeof rawAction.targetIndex === "number" ? (rawAction.targetIndex as number) : undefined;
    const targetStr = typeof rawAction.target === "string" ? rawAction.target : typeof rawAction.selector === "string" ? (rawAction.selector as string) : undefined;
    const textVal = typeof rawAction.text === "string" ? rawAction.text : typeof rawAction.value === "string" ? (rawAction.value as string) : undefined;
    const urlVal = typeof rawAction.url === "string" ? rawAction.url : undefined;
    const codeVal = typeof rawAction.code === "string" ? rawAction.code : typeof rawAction.expression === "string" ? (rawAction.expression as string) : undefined;

    const params: Record<string, unknown> = {
      ...(rawAction.params && typeof rawAction.params === "object" ? (rawAction.params as Record<string, unknown>) : {}),
      target: targetStr,
      text: textVal,
      url: urlVal,
      code: codeVal,
      index,
    };

    const proposal: ActionProposal = {
      type: actionTypeRaw,
      index,
      description: typeof rawAction.description === "string" ? rawAction.description : `${actionTypeRaw} ${targetStr ?? index ?? ""}`,
      category,
      domain,
      params,
    };

    return {
      status: "CONTINUE",
      thought,
      action: proposal,
      confidence,
    };
  }

  private failDecision(reason: string): LLMActionDecision {
    return {
      status: "FAIL",
      thought: `Parsing error: ${reason}`,
      action: null,
      finalAnswer: `Task failed: ${reason}`,
      confidence: 0,
    };
  }
}
