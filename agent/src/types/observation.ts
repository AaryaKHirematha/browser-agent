// ── Observation Types ────────────────────────────────────────────────────────
// Types for the adaptive observation system.

/** The observation mode the engine selects. */
export type ObservationMode =
  | "STATE"       // browser_get_state: flat interactive element list
  | "GRAPH"       // browser_get_graph: semantic UI tree
  | "GRAPH_DELTA" // browser_graph_delta: mutations since last read
  | "VISUAL"      // Screenshot capture
  | "HYBRID";     // Combination of multiple modes

/** Reason the engine chose a particular mode. */
export interface ObservationRationale {
  mode: ObservationMode;
  reason: string;
  /** Confidence in the mode selection (0-1). */
  confidence: number;
}

/** Metadata about a single observation. */
export interface ObservationMeta {
  mode: ObservationMode;
  rationale: ObservationRationale;
  timestamp: number;
  /** Approximate size of the observation payload in characters. */
  sizeChars: number;
  /** Estimated token count (~chars/4). */
  estimatedTokens: number;
  /** Time taken to produce the observation in ms. */
  latencyMs: number;
  /** Current page URL. */
  url: string;
  /** Current page title. */
  title: string;
}

/** A unified element representation combining DOM + graph + visual info. */
export interface UnifiedElement {
  index: number;
  role: string;
  text: string;
  label?: string;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
  /** Semantic context from the UI graph (parent landmarks, headings). */
  semanticContext?: string;
  /** Whether the element is in the viewport. */
  inViewport?: boolean;
  /** Additional attributes for disambiguation. */
  attributes?: Record<string, string>;
}

/** The unified observation returned by browser_observe. */
export interface UnifiedObservation {
  meta: ObservationMeta;
  /** Flattened list of interactive elements (always present). */
  elements: UnifiedElement[];
  /** Semantic graph text representation (when mode is GRAPH or HYBRID). */
  graphText?: string;
  /** Graph mutations since last observation (when mode is GRAPH_DELTA). */
  graphDelta?: unknown[];
  /** Base64-encoded screenshot (when mode is VISUAL or HYBRID). */
  screenshot?: string;
  /** Page-level information. */
  page: {
    url: string;
    title: string;
    scrollPosition: { x: number; y: number };
    viewportSize: { width: number; height: number };
    atTop: boolean;
    atBottom: boolean;
  };
  /** Count of interactive elements. */
  interactiveCount: number;
  /** Whether the observation was truncated. */
  truncated: boolean;
}

/** Result of local visual analysis on page layout and structure. */
export interface VisualAnalysisResult {
  /** Confidence in the visual analysis (0-1). */
  confidence: number;
  /** Status of local visual analyzer. */
  analyzerStatus: "ENABLED" | "DISABLED_FALLBACK" | "OPTIONAL_UNAVAILABLE";
  /** Layout blocks detected on page. */
  detectedRegions?: Array<{
    id: string;
    role: string;
    bounds: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
  /** Visual ambiguity score (0 = clear layout, 1 = high overlap/ambiguity). */
  visualAmbiguityScore?: number;
  /** Bounding boxes of visual elements containing sensitive input types. */
  sensitiveVisualRegions?: Array<{
    type: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  /** SIH 26171 On-Device Local Vision Model Metadata. */
  modelMetadata?: {
    modelName: string;
    modelFormat: string;
    runtime: "WEBGPU" | "WASM" | "HYBRID_LOCAL" | "DETERMINISTIC";
    backend: string;
    modelSizeBytes: number;
    initLatencyMs: number;
    inferenceLatencyMs: number;
    memoryUsageMB?: number;
    fallbackActive: boolean;
  };
  /** Spatial relationships between detected visual regions. */
  spatialRelationships?: Array<{
    sourceId: string;
    targetId: string;
    relation: "ABOVE" | "BELOW" | "INSIDE" | "ADJACENT_LEFT" | "ADJACENT_RIGHT";
  }>;
}

/** Complete normalized representation returned by the Unified Perception Layer. */
export interface UnifiedPerceptionResult extends UnifiedObservation {
  /** Local visual analysis metrics (if visual analysis ran or fell back). */
  visualAnalysis?: VisualAnalysisResult;
  /** Unified perception confidence score (0-1). */
  perceptionConfidence: number;
  /** Summary of sensitive data findings & redaction status from Privacy Firewall. */
  sensitiveDataSummary?: {
    detectedCount: number;
    redactedCount: number;
    typesFound: string[];
    privacyPolicyApplied: string;
  };
  /** Security & prompt injection findings. */
  securitySummary?: {
    injectionsDetected: number;
    hasCriticalWarning: boolean;
    warnings: string[];
  };
  /** Whether privacy firewall sanitization was applied to this perception result. */
  sanitized: boolean;
}

