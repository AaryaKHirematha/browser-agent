// ── Adaptive Observation Engine ───────────────────────────────────────────────
// Selects the optimal observation mode based on task context, page complexity,
// previous observations, and uncertainty level.
// Wraps existing bridge calls — does NOT duplicate state/graph implementations.

import type {
  ObservationMode,
  ObservationRationale,
  ObservationMeta,
  UnifiedObservation,
  UnifiedElement,
  UnifiedPerceptionResult,
  VisualAnalysisResult,
} from "../types/observation.js";
import type { Bridge } from "../bridge.js";
import { LocalVisualAnalyzer } from "./visual/analyzer.js";

/** Hints that help the adaptive observer choose a mode. */
export interface ObserveHints {
  /** The user's task description. */
  task?: string;
  /** The last observation mode used. */
  lastMode?: ObservationMode;
  /** Whether the page has changed since last observation. */
  pageChanged?: boolean;
  /** Whether to force a specific mode. */
  forceMode?: ObservationMode;
  /** Whether to include a screenshot. */
  includeScreenshot?: boolean;
  /** Maximum interactive nodes (for graph mode). */
  maxNodes?: number;
  /** Task query for graph filtering. */
  query?: string;
}

export class AdaptiveObserver {
  private localVisualAnalyzer = new LocalVisualAnalyzer();

  constructor(private bridge: Bridge) {}



  /** Produce a unified observation, auto-selecting the best mode. */
  async observe(hints: ObserveHints = {}): Promise<UnifiedObservation> {
    const t0 = Date.now();
    const rationale = this.selectMode(hints);
    const mode = hints.forceMode ?? rationale.mode;

    let elements: UnifiedElement[] = [];
    let graphText: string | undefined;
    let graphDelta: unknown[] | undefined;
    let screenshot: string | undefined;
    let url = "";
    let title = "";
    let scrollPosition = { x: 0, y: 0 };
    let viewportSize = { width: 0, height: 0 };
    let atTop = true;
    let atBottom = false;
    let interactiveCount = 0;
    let truncated = false;
    let sizeChars = 0;

    try {
      switch (mode) {
        case "STATE": {
          const state = await this.getState();
          elements = this.stateToElements(state);
          url = state.url ?? "";
          title = state.title ?? "";
          scrollPosition = { x: state.viewport?.scrollX ?? 0, y: state.viewport?.scrollY ?? 0 };
          viewportSize = { width: state.viewport?.width ?? 0, height: state.viewport?.height ?? 0 };
          atTop = state.scroll?.atTop ?? true;
          atBottom = state.scroll?.atBottom ?? false;
          interactiveCount = elements.length;
          sizeChars = JSON.stringify(state).length;
          break;
        }
        case "GRAPH": {
          const graph = await this.getGraph(hints.query, hints.maxNodes);
          graphText = graph.text ?? "";
          elements = this.graphToElements(graph);
          url = graph.url ?? "";
          title = graph.title ?? "";
          interactiveCount = graph.count ?? 0;
          truncated = graph.truncated ?? false;
          sizeChars = (graphText ?? "").length;
          // Also get scroll info from a lightweight state call
          try {
            const state = await this.getState();
            scrollPosition = { x: state.viewport?.scrollX ?? 0, y: state.viewport?.scrollY ?? 0 };
            viewportSize = { width: state.viewport?.width ?? 0, height: state.viewport?.height ?? 0 };
            atTop = state.scroll?.atTop ?? true;
            atBottom = state.scroll?.atBottom ?? false;
          } catch { /* scroll info is optional */ }
          break;
        }
        case "GRAPH_DELTA": {
          const delta = await this.bridge.send({ type: "GRAPH_DELTA" }) as unknown[];
          graphDelta = delta;
          sizeChars = JSON.stringify(delta).length;
          // Get current page info
          try {
            const state = await this.getState();
            url = state.url ?? "";
            title = state.title ?? "";
            elements = this.stateToElements(state);
            interactiveCount = elements.length;
            scrollPosition = { x: state.viewport?.scrollX ?? 0, y: state.viewport?.scrollY ?? 0 };
            viewportSize = { width: state.viewport?.width ?? 0, height: state.viewport?.height ?? 0 };
            atTop = state.scroll?.atTop ?? true;
            atBottom = state.scroll?.atBottom ?? false;
          } catch { /* state is best-effort in delta mode */ }
          break;
        }
        case "VISUAL": {
          // Screenshot + lightweight state
          try {
            screenshot = await this.captureScreenshot();
          } catch { /* screenshot not available */ }
          const state = await this.getState();
          elements = this.stateToElements(state);
          url = state.url ?? "";
          title = state.title ?? "";
          interactiveCount = elements.length;
          scrollPosition = { x: state.viewport?.scrollX ?? 0, y: state.viewport?.scrollY ?? 0 };
          viewportSize = { width: state.viewport?.width ?? 0, height: state.viewport?.height ?? 0 };
          atTop = state.scroll?.atTop ?? true;
          atBottom = state.scroll?.atBottom ?? false;
          sizeChars = JSON.stringify(state).length + (screenshot?.length ?? 0);
          break;
        }
        case "HYBRID": {
          // Graph + screenshot
          const graph = await this.getGraph(hints.query, hints.maxNodes);
          graphText = graph.text ?? "";
          elements = this.graphToElements(graph);
          url = graph.url ?? "";
          title = graph.title ?? "";
          interactiveCount = graph.count ?? 0;
          truncated = graph.truncated ?? false;
          try {
            screenshot = await this.captureScreenshot();
          } catch { /* graceful degradation */ }
          try {
            const state = await this.getState();
            scrollPosition = { x: state.viewport?.scrollX ?? 0, y: state.viewport?.scrollY ?? 0 };
            viewportSize = { width: state.viewport?.width ?? 0, height: state.viewport?.height ?? 0 };
            atTop = state.scroll?.atTop ?? true;
            atBottom = state.scroll?.atBottom ?? false;
          } catch { /* best-effort */ }
          sizeChars = (graphText ?? "").length + (screenshot?.length ?? 0);
          break;
        }
      }

      if (hints.includeScreenshot && !screenshot) {
        try {
          screenshot = await this.captureScreenshot();
        } catch { /* screenshot is optional */ }
      }
    } catch (err) {
      // Fallback: try the simplest possible observation
      try {
        const state = await this.getState();
        elements = this.stateToElements(state);
        url = state.url ?? "";
        title = state.title ?? "";
        interactiveCount = elements.length;
        sizeChars = JSON.stringify(state).length;
      } catch { /* truly no observation possible */ }
    }

    const latencyMs = Date.now() - t0;

    return {
      meta: {
        mode,
        rationale: { ...rationale, mode },
        timestamp: Date.now(),
        sizeChars,
        estimatedTokens: Math.round(sizeChars / 4),
        latencyMs,
        url,
        title,
      },
      elements,
      graphText,
      graphDelta,
      screenshot,
      page: { url, title, scrollPosition, viewportSize, atTop, atBottom },
      interactiveCount,
      truncated,
    };
  }

  /**
   * Produce a normalized UnifiedPerceptionResult combining state, graph, graph delta,
   * screenshot, confidence metrics, and observation metadata.
   * Additive method over observe() for multi-modal perception callers.
   */
  async perceive(hints: ObserveHints = {}): Promise<UnifiedPerceptionResult> {
    try {
      const baseObs = await this.observe(hints);

      // Calculate perception confidence score based on element richness and observation completeness
      let confidence = baseObs.meta.rationale.confidence ?? 0.8;
      if (!baseObs.page.url && baseObs.elements.length === 0) {
        confidence = 0.1;
      } else {
        if (baseObs.elements.length === 0) {
          confidence = Math.max(0.3, confidence - 0.3);
        }
        if (baseObs.truncated) {
          confidence = Math.max(0.4, confidence - 0.1);
        }
        if ((baseObs.meta.mode === "VISUAL" || baseObs.meta.mode === "HYBRID" || hints.includeScreenshot) && !baseObs.screenshot) {
          confidence = Math.max(0.4, confidence - 0.2);
        }
      }

      let visualAnalysis: VisualAnalysisResult | undefined;
      const isVisualMode = baseObs.meta.mode === "VISUAL" || baseObs.meta.mode === "HYBRID" || hints.includeScreenshot;
      if (isVisualMode) {
        try {
          visualAnalysis = this.localVisualAnalyzer.analyze({
            elements: baseObs.elements,
            viewportSize: baseObs.page.viewportSize,
            scrollPosition: baseObs.page.scrollPosition,
            screenshot: baseObs.screenshot,
          });
        } catch {
          visualAnalysis = {
            confidence: 0,
            analyzerStatus: "DISABLED_FALLBACK",
            visualAmbiguityScore: 1.0,
            detectedRegions: [],
            sensitiveVisualRegions: [],
          };
        }
      }

      return {
        ...baseObs,
        visualAnalysis,
        perceptionConfidence: Number(confidence.toFixed(2)),
        sanitized: false,
      };


    } catch (err) {
      // Safe fallback perception when bridge fails completely
      const now = Date.now();
      return {
        meta: {
          mode: hints.forceMode ?? "STATE",
          rationale: { mode: hints.forceMode ?? "STATE", reason: `Bridge error fallback: ${err instanceof Error ? err.message : String(err)}`, confidence: 0.1 },
          timestamp: now,
          sizeChars: 0,
          estimatedTokens: 0,
          latencyMs: 0,
          url: "",
          title: "Observation Failure Fallback",
        },
        elements: [],
        page: {
          url: "",
          title: "Observation Failure Fallback",
          scrollPosition: { x: 0, y: 0 },
          viewportSize: { width: 0, height: 0 },
          atTop: true,
          atBottom: false,
        },
        interactiveCount: 0,
        truncated: false,
        perceptionConfidence: 0.1,
        sanitized: false,
      };
    }
  }


  /** Determine the best observation mode. */
  private selectMode(hints: ObserveHints): ObservationRationale {
    if (hints.forceMode) {
      return { mode: hints.forceMode, reason: `Forced mode: ${hints.forceMode}`, confidence: 1.0 };
    }

    const task = (hints.task ?? "").toLowerCase();

    // After an action, check what changed
    if (hints.lastMode && hints.pageChanged) {
      return {
        mode: "GRAPH_DELTA",
        reason: "Page changed after previous action; checking delta",
        confidence: 0.8,
      };
    }

    // Simple click/type tasks → STATE (fast, lightweight)
    if (/^(click|tap|press|select|check|uncheck|type|enter|fill|input)\b/i.test(task)) {
      return {
        mode: "STATE",
        reason: "Simple interaction task; flat state is efficient",
        confidence: 0.8,
      };
    }

    // Navigation/search/find tasks → GRAPH (semantic context helps)
    if (/^(find|search|look|navigate|go\s+to|open|browse|explore|locate)/i.test(task)) {
      return {
        mode: "GRAPH",
        reason: "Navigation/search task; semantic graph provides structural context",
        confidence: 0.85,
      };
    }

    // Visual tasks → VISUAL or HYBRID
    if (/visual|screenshot|image|chart|graph|layout|design|diagram|dashboard/i.test(task)) {
      return {
        mode: "HYBRID",
        reason: "Visual understanding needed; combining graph + screenshot",
        confidence: 0.75,
      };
    }

    // Complex multi-step tasks → GRAPH
    if (/settings|preferences|configuration|form|step|wizard|checkout/i.test(task)) {
      return {
        mode: "GRAPH",
        reason: "Complex task requiring semantic context",
        confidence: 0.8,
      };
    }

    // Default: GRAPH is generally the best balance
    return {
      mode: "GRAPH",
      reason: "Default mode; semantic graph provides best general representation",
      confidence: 0.7,
    };
  }

  // ── Bridge Helpers ────────────────────────────────────────────────────────

  private async getState(): Promise<Record<string, any>> {
    const result = await this.bridge.send({ type: "GET_STATE" });
    return (result as Record<string, any>) ?? {};
  }

  private async getGraph(query?: string, maxNodes?: number): Promise<Record<string, any>> {
    const result = await this.bridge.send({
      type: "GET_GRAPH",
      query,
      maxNodes: maxNodes ?? 200,
    });
    return (result as Record<string, any>) ?? {};
  }

  private async captureScreenshot(): Promise<string> {
    const result = await this.bridge.send({ type: "SCREENSHOT" });
    return (result as { screenshot?: string })?.screenshot ?? "";
  }

  // ── Element Conversion ────────────────────────────────────────────────────

  private stateToElements(state: Record<string, any>): UnifiedElement[] {
    const raw = state.elements as Array<Record<string, any>> | undefined;
    if (!raw) return [];
    return raw.map((el) => ({
      index: el.index ?? 0,
      role: el.role ?? el.tag ?? "unknown",
      text: el.text ?? "",
      label: el.ariaLabel ?? undefined,
      visible: true,
      enabled: !el.disabled,
      editable: el.editable ?? false,
      boundingBox: el.rect,
      inViewport: el.inViewport,
      attributes: el.attributes,
    }));
  }

  private graphToElements(graph: Record<string, any>): UnifiedElement[] {
    // Graph projection gives a tree with [#index] handles.
    // Parse from the tree structure if available.
    const tree = graph.tree;
    if (!tree) return [];
    const elements: UnifiedElement[] = [];
    this.flattenTree(tree, elements);
    return elements;
  }

  private flattenTree(node: Record<string, any>, out: UnifiedElement[]): void {
    if (node.interactive && node.index != null) {
      out.push({
        index: node.index,
        role: node.role ?? "unknown",
        text: node.name ?? "",
        visible: true,
        enabled: node.enabled ?? true,
        editable: false,
        semanticContext: node.role,
      });
    }
    if (node.children) {
      for (const child of node.children) {
        this.flattenTree(child, out);
      }
    }
  }
}
