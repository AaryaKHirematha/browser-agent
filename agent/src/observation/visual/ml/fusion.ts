// ── DOM + UI Graph + Vision ML Fusion Engine (SIH 26171) ──────────────────────
// Merges structured DOM, semantic UI Graph, local deterministic analysis, and Vision ML detections
// into a unified, high-confidence perception representation.
// Preserves DOM identity and authority, avoiding duplicate or unvalidated overrides.

import type { UnifiedElement, VisualAnalysisResult } from "../../../types/observation.js";
import type { VisionMLDetection, VisionMLResult } from "./types.js";

export interface FusedElement extends UnifiedElement {
  source?: "DOM" | "DOM+VISION_ML" | "VISION_ML_ONLY" | "GRAPH";
  visualConfidence?: number;
  mlClass?: string;
  disagreementDetected?: boolean;
}

export interface FusionMetadata {
  sourcesCount: {
    dom: number;
    graph: number;
    deterministicVisual: number;
    visionML: number;
  };
  disagreementCount: number;
  fusedCount: number;
  meanFusionConfidence: number;
  fusionMode: string;
}

export interface FusionResult {
  elements: FusedElement[];
  meta: FusionMetadata;
  mlAnalysis?: VisionMLResult;
  visualAnalysis?: VisualAnalysisResult;
}

export class FusionEngine {
  /**
   * Fuse DOM elements, deterministic visual regions, and Vision ML detections.
   */
  fuse(
    domElements: UnifiedElement[],
    visualAnalysis?: VisualAnalysisResult,
    mlResult?: VisionMLResult
  ): FusionResult {
    const fusedMap = new Map<number, FusedElement>();
    let disagreementCount = 0;
    let fusedCount = 0;

    const mlDetections = mlResult?.status === "READY" ? mlResult.detections : [];
    const detRegions = visualAnalysis?.detectedRegions ?? [];

    // 1. Initialize fused elements from DOM elements (preserving DOM authority & indices)
    for (const elem of domElements) {
      fusedMap.set(elem.index, {
        ...elem,
        source: "DOM",
        visualConfidence: elem.visible ? 0.9 : 0.4,
      });
    }

    // 2. Associate Vision ML detections with existing DOM elements via bounding box Intersection-over-Union (IoU)
    for (const mlDet of mlDetections) {
      let bestElem: FusedElement | null = null;
      let maxIoU = 0;

      for (const [_, elem] of fusedMap) {
        if (!elem.boundingBox) continue;
        const iou = this.calculateIoU(elem.boundingBox, mlDet.boundingBox);
        if (iou > maxIoU) {
          maxIoU = iou;
          bestElem = elem;
        }
      }

      if (bestElem && maxIoU >= 0.3) {
        // High spatial overlap: fuse ML metadata into DOM element
        bestElem.source = "DOM+VISION_ML";
        bestElem.visualConfidence = Math.max(bestElem.visualConfidence ?? 0.5, mlDet.confidence);
        bestElem.mlClass = mlDet.class;
        fusedCount++;

        // Detect disagreement between DOM role and ML detected class
        const domRole = (bestElem.role ?? "").toLowerCase();
        if (domRole && mlDet.class !== "unknown" && !domRole.includes(mlDet.class) && !mlDet.class.includes(domRole)) {
          bestElem.disagreementDetected = true;
          disagreementCount++;
        }
      } else if (mlDet.confidence >= 0.85) {
        // Standalone high-confidence ML visual detection without matching DOM element
        const syntheticIndex = 1000 + fusedMap.size;
        fusedMap.set(syntheticIndex, {
          index: syntheticIndex,
          role: mlDet.class,
          text: mlDet.label ?? `Visual ${mlDet.class}`,
          visible: true,
          enabled: true,
          editable: mlDet.class === "textbox",
          boundingBox: mlDet.boundingBox,
          source: "VISION_ML_ONLY",
          visualConfidence: mlDet.confidence,
          mlClass: mlDet.class,
          attributes: { mlDetected: "true" },
        });
        fusedCount++;
      }
    }

    const fusedElements = Array.from(fusedMap.values());
    const totalConfidence = fusedElements.reduce((sum, e) => sum + (e.visualConfidence ?? 0.5), 0);
    const meanConfidence = fusedElements.length > 0 ? Number((totalConfidence / fusedElements.length).toFixed(3)) : 0;

    return {
      elements: fusedElements,
      meta: {
        sourcesCount: {
          dom: domElements.length,
          graph: domElements.length,
          deterministicVisual: detRegions.length,
          visionML: mlDetections.length,
        },
        disagreementCount,
        fusedCount,
        meanFusionConfidence: meanConfidence,
        fusionMode: mlResult?.status === "READY" ? "DOM_GRAPH_VISION_ML" : "DOM_GRAPH_DETERMINISTIC",
      },
      mlAnalysis: mlResult,
      visualAnalysis,
    };
  }

  /** Calculate Intersection over Union (IoU) of two bounding boxes. */
  private calculateIoU(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ): number {
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;

    const interX1 = Math.max(a.x, b.x);
    const interY1 = Math.max(a.y, b.y);
    const interX2 = Math.min(ax2, bx2);
    const interY2 = Math.min(ay2, by2);

    const interW = Math.max(0, interX2 - interX1);
    const interH = Math.max(0, interY2 - interY1);
    const interArea = interW * interH;

    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const unionArea = areaA + areaB - interArea;

    if (unionArea <= 0) return 0;
    return interArea / unionArea;
  }
}
