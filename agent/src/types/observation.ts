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
