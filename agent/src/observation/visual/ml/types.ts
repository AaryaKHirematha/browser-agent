// ── Real Lightweight On-Device Vision ML Types (SIH 26171) ──────────────────────

export type VisionMLBackend = "webgpu" | "wasm" | "cpu" | "unavailable";

export type VisionMLStatus = "READY" | "UNAVAILABLE" | "TIMED_OUT" | "ERROR" | "DISABLED";

export type VisionUIClass =
  | "button"
  | "textbox"
  | "navigation"
  | "card"
  | "dialog"
  | "menu"
  | "image"
  | "text_block"
  | "unknown";

export interface VisionMLDetection {
  class: VisionUIClass;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  label?: string;
  attributes?: Record<string, unknown>;
}

export interface VisionMLResult {
  modelId: string;
  modelVersion: string;
  backend: VisionMLBackend;
  inferenceTimeMs: number;
  imageWidth: number;
  imageHeight: number;
  detections: VisionMLDetection[];
  confidence: number;
  status: VisionMLStatus;
  fallbackReason?: string;
}

export interface VisionMLConfig {
  modelPath?: string;
  confidenceThreshold?: number;
  timeoutMs?: number;
  preferredBackend?: VisionMLBackend;
  enabled?: boolean;
  maxDetections?: number;
}

export interface VisionMLAdapterInterface {
  initialize(): Promise<boolean>;
  isAvailable(): boolean;
  analyze(input: {
    screenshot?: string;
    width?: number;
    height?: number;
    elements?: Array<unknown>;
  }): Promise<VisionMLResult>;
  getBackend(): VisionMLBackend;
  dispose(): Promise<void>;
}
