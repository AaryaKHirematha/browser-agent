import zlib from "node:zlib";
import type {
  SensitiveDataType,
  PrivacyPolicyDecision,
  SensitiveDataDetection,
} from "../types/privacy.js";

export interface ScreenshotRegion {
  type: SensitiveDataType | string;
  bounds: { x: number; y: number; width: number; height: number };
  decision?: PrivacyPolicyDecision;
}

export interface SanitizedScreenshotResult {
  /** Sanitized base64 screenshot (never raw if sensitive regions exist). */
  sanitizedScreenshot?: string;
  width?: number;
  height?: number;
  format?: string;
  protectedRegionCount: number;
  redactedCount: number;
  maskedCount: number;
  omittedCount: number;
  approvalRequiredCount: number;
  allowedCount: number;
  status: "PASS" | "SANITIZED" | "FAIL_CLOSED";
  processingLatencyMs: number;
  failClosed: boolean;
  diagnostics?: string[];
}

export class ScreenshotPrivacyProcessor {
  /**
   * Process a base64 PNG screenshot, applying pixel transformations according to local visual regions and privacy policy decisions.
   * Single-pass, deterministic local pixel transformation — NEVER leaks raw screenshot on failure.
   */
  processScreenshot(
    rawScreenshot?: string,
    visualRegions?: Array<{ type: string; bounds: { x: number; y: number; width: number; height: number } }>,
    detections?: SensitiveDataDetection[],
    dimensions?: { width: number; height: number }
  ): SanitizedScreenshotResult {
    const t0 = Date.now();

    if (!rawScreenshot || rawScreenshot.length === 0) {
      return {
        status: "PASS",
        protectedRegionCount: 0,
        redactedCount: 0,
        maskedCount: 0,
        omittedCount: 0,
        approvalRequiredCount: 0,
        allowedCount: 0,
        failClosed: false,
        processingLatencyMs: Date.now() - t0,
        diagnostics: ["No screenshot payload provided"],
      };
    }

    try {
      // Clean base64 input prefix if present
      const cleanBase64 = rawScreenshot.replace(/^data:image\/\w+;base64,/, "").trim();
      const rawBuffer = Buffer.from(cleanBase64, "base64");

      if (rawBuffer.length < 24) {
        throw new Error("Invalid screenshot payload: buffer too short");
      }

      // Collect and normalize sensitive regions with policy decisions
      const normalizedRegions = this.collectAndNormalizeRegions(
        visualRegions,
        detections
      );

      if (normalizedRegions.length === 0) {
        // If no sensitive regions exist, return image marked PASS without re-encoding
        return {
          sanitizedScreenshot: cleanBase64,
          width: dimensions?.width,
          height: dimensions?.height,
          format: "png",
          protectedRegionCount: 0,
          redactedCount: 0,
          maskedCount: 0,
          omittedCount: 0,
          approvalRequiredCount: 0,
          allowedCount: 0,
          status: "PASS",
          processingLatencyMs: Date.now() - t0,
          failClosed: false,
        };
      }

      // Parse PNG structure and extract dimensions
      const pngInfo = this.parsePng(rawBuffer);
      const imgWidth = dimensions?.width || pngInfo.width;
      const imgHeight = dimensions?.height || pngInfo.height;

      let redactedCount = 0;
      let maskedCount = 0;
      let omittedCount = 0;
      let approvalRequiredCount = 0;
      let allowedCount = 0;

      // Filter and clamp regions to actual image bounds
      const validRegionsToApply: Array<{
        bounds: { x: number; y: number; width: number; height: number };
        decision: PrivacyPolicyDecision;
      }> = [];

      for (const reg of normalizedRegions) {
        const validatedBounds = this.validateAndClampBounds(reg.bounds, imgWidth, imgHeight);
        if (!validatedBounds) continue;

        switch (reg.decision) {
          case "OMIT":
            omittedCount++;
            validRegionsToApply.push({ bounds: validatedBounds, decision: "OMIT" });
            break;
          case "REQUIRE_APPROVAL":
            approvalRequiredCount++;
            validRegionsToApply.push({ bounds: validatedBounds, decision: "REQUIRE_APPROVAL" });
            break;
          case "REDACT":
            redactedCount++;
            validRegionsToApply.push({ bounds: validatedBounds, decision: "REDACT" });
            break;
          case "MASK":
            maskedCount++;
            validRegionsToApply.push({ bounds: validatedBounds, decision: "MASK" });
            break;
          case "ALLOW":
            allowedCount++;
            break;
        }
      }

      const activeProtectedCount = validRegionsToApply.length;
      if (activeProtectedCount === 0) {
        return {
          sanitizedScreenshot: cleanBase64,
          width: imgWidth,
          height: imgHeight,
          format: "png",
          protectedRegionCount: 0,
          redactedCount,
          maskedCount,
          omittedCount,
          approvalRequiredCount,
          allowedCount,
          status: "PASS",
          processingLatencyMs: Date.now() - t0,
          failClosed: false,
        };
      }

      // Perform pixel transformation on PNG scanlines
      const transformedPngBuffer = this.transformPngPixels(
        pngInfo,
        validRegionsToApply
      );

      // Verify transformed PNG output
      if (!transformedPngBuffer || transformedPngBuffer.length < 24) {
        throw new Error("Sanitization verification failed: empty transformed buffer");
      }

      const sanitizedBase64 = transformedPngBuffer.toString("base64");

      return {
        sanitizedScreenshot: sanitizedBase64,
        width: imgWidth,
        height: imgHeight,
        format: "png",
        protectedRegionCount: activeProtectedCount,
        redactedCount,
        maskedCount,
        omittedCount,
        approvalRequiredCount,
        allowedCount,
        status: "SANITIZED",
        processingLatencyMs: Date.now() - t0,
        failClosed: false,
      };
    } catch (err) {
      // ABSOLUTE SECURITY RULE: Fail closed — DISCARD raw screenshot on error!
      return {
        sanitizedScreenshot: undefined, // Never expose raw screenshot!
        protectedRegionCount: 0,
        redactedCount: 0,
        maskedCount: 0,
        omittedCount: 0,
        approvalRequiredCount: 0,
        allowedCount: 0,
        status: "FAIL_CLOSED",
        processingLatencyMs: Date.now() - t0,
        failClosed: true,
        diagnostics: [`Screenshot privacy processing failed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  /** Validate bounding box coordinates, handling negative, fractional, NaN, Infinity, and out-of-bounds bounds cleanly. */
  validateAndClampBounds(
    bounds: { x: number; y: number; width: number; height: number },
    imgWidth: number,
    imgHeight: number
  ): { x: number; y: number; width: number; height: number } | null {
    if (!bounds || typeof bounds !== "object") return null;

    let { x, y, width, height } = bounds;

    if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
      return null;
    }

    if (isNaN(x) || !isFinite(x) || isNaN(y) || !isFinite(y) || isNaN(width) || !isFinite(width) || isNaN(height) || !isFinite(height)) {
      return null;
    }

    if (width <= 0 || height <= 0) return null;

    x = Math.floor(x);
    y = Math.floor(y);
    width = Math.ceil(width);
    height = Math.ceil(height);

    if (x >= imgWidth || y >= imgHeight || x + width <= 0 || y + height <= 0) {
      return null;
    }

    const clampedX = Math.max(0, Math.min(imgWidth - 1, x));
    const clampedY = Math.max(0, Math.min(imgHeight - 1, y));
    const clampedW = Math.max(1, Math.min(imgWidth - clampedX, width - (clampedX - x)));
    const clampedH = Math.max(1, Math.min(imgHeight - clampedY, height - (clampedY - y)));

    return { x: clampedX, y: clampedY, width: clampedW, height: clampedH };
  }

  private collectAndNormalizeRegions(
    visualRegions?: Array<{ type: string; bounds: { x: number; y: number; width: number; height: number } }>,
    detections?: SensitiveDataDetection[]
  ): Array<{ bounds: { x: number; y: number; width: number; height: number }; decision: PrivacyPolicyDecision }> {
    const regionMap = new Map<string, PrivacyPolicyDecision>();

    // 1. Incorporate Phase 3 sensitive visual regions
    if (visualRegions) {
      for (const vr of visualRegions) {
        if (!vr || !vr.bounds) continue;
        const key = `${vr.bounds.x},${vr.bounds.y},${vr.bounds.width},${vr.bounds.height}`;
        const defaultDecision = vr.type === "PASSWORD" || vr.type === "SECRET" ? "OMIT" : "REDACT";
        regionMap.set(key, this.resolvePolicyPrecedence(regionMap.get(key), defaultDecision));
      }
    }

    // 2. Incorporate Phase 5 detection bounding boxes & firewall decisions
    if (detections) {
      for (const d of detections) {
        if (!d || !d.boundingBox) continue;
        const b = d.boundingBox;
        const key = `${b.x},${b.y},${b.width},${b.height}`;
        const decision = d.firewallDecision ?? "REDACT";
        regionMap.set(key, this.resolvePolicyPrecedence(regionMap.get(key), decision));
      }
    }

    const result: Array<{ bounds: { x: number; y: number; width: number; height: number }; decision: PrivacyPolicyDecision }> = [];
    for (const [key, decision] of regionMap.entries()) {
      const [x, y, width, height] = key.split(",").map(Number);
      result.push({ bounds: { x, y, width, height }, decision });
    }

    return result;
  }

  /** Conservative policy conflict resolution: OMIT > REQUIRE_APPROVAL > MASK / REDACT > ALLOW */
  private resolvePolicyPrecedence(
    existing: PrivacyPolicyDecision | undefined,
    incoming: PrivacyPolicyDecision
  ): PrivacyPolicyDecision {
    if (!existing) return incoming;
    const rank: Record<PrivacyPolicyDecision, number> = {
      OMIT: 5,
      REQUIRE_APPROVAL: 4,
      MASK: 3,
      REDACT: 3,
      ALLOW: 1,
    };
    return rank[incoming] > rank[existing] ? incoming : existing;
  }

  /** Local PNG parser extracting header, dimensions, and IDAT scanlines using node:zlib. */
  private parsePng(buffer: Buffer) {
    if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
      throw new Error("Invalid PNG signature");
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 8;
    let colorType = 6;
    const idatBuffers: Buffer[] = [];

    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) break;
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);

      if (type === "IHDR") {
        width = buffer.readUInt32BE(offset + 8);
        height = buffer.readUInt32BE(offset + 12);
        bitDepth = buffer[offset + 16];
        colorType = buffer[offset + 17];
      } else if (type === "IDAT") {
        idatBuffers.push(buffer.subarray(offset + 8, offset + 8 + length));
      } else if (type === "IEND") {
        break;
      }
      offset += 12 + length;
    }

    if (width === 0 || height === 0 || idatBuffers.length === 0) {
      throw new Error("Malformed PNG structure or missing IDAT chunk");
    }

    const compressed = Buffer.concat(idatBuffers);
    const uncompressed = zlib.inflateSync(compressed);

    return { buffer, width, height, bitDepth, colorType, uncompressed };
  }

  /** Apply pixel transformations (solid fill or masked suffix) directly onto uncompressed scanlines and re-compress PNG. */
  private transformPngPixels(
    pngInfo: { width: number; height: number; bitDepth: number; colorType: number; uncompressed: Buffer },
    regions: Array<{ bounds: { x: number; y: number; width: number; height: number }; decision: PrivacyPolicyDecision }>
  ): Buffer {
    const { width, height, colorType, uncompressed } = pngInfo;
    const bytesPerPixel = colorType === 6 ? 4 : 3;
    const stride = 1 + width * bytesPerPixel;

    // Work on a copy of scanlines
    const scanlines = Buffer.from(uncompressed);

    for (const reg of regions) {
      const { x, y, width: w, height: h } = reg.bounds;

      for (let r = y; r < y + h && r < height; r++) {
        const rowOffset = r * stride + 1;

        for (let c = x; c < x + w && c < width; c++) {
          const pxOffset = rowOffset + c * bytesPerPixel;
          if (pxOffset + bytesPerPixel > scanlines.length) continue;

          if (reg.decision === "MASK") {
            // Apply opaque fill for prefix pixels, preserving suffix only if region width permits safe suffix boundary
            const suffixStart = x + Math.floor(w * 0.75);
            if (c < suffixStart) {
              scanlines[pxOffset] = 15;     // Red
              scanlines[pxOffset + 1] = 15; // Green
              scanlines[pxOffset + 2] = 19; // Blue
              if (bytesPerPixel === 4) scanlines[pxOffset + 3] = 255;
            }
          } else {
            // Opaque solid fill for REDACT, OMIT, REQUIRE_APPROVAL
            scanlines[pxOffset] = 15;     // Red
            scanlines[pxOffset + 1] = 15; // Green
            scanlines[pxOffset + 2] = 19; // Blue
            if (bytesPerPixel === 4) scanlines[pxOffset + 3] = 255;
          }
        }
      }

      // Verify that the target region was transformed
      if (reg.decision !== "ALLOW") {
        const verifyRow = y;
        const verifyCol = x;
        const pxOffset = verifyRow * stride + 1 + verifyCol * bytesPerPixel;
        if (pxOffset + bytesPerPixel <= scanlines.length) {
          if (scanlines[pxOffset] !== 15 || scanlines[pxOffset + 1] !== 15 || scanlines[pxOffset + 2] !== 19) {
            throw new Error("Sanitization verification failed: protected region pixel was not transformed");
          }
        }
      }
    }

    const recompressed = zlib.deflateSync(scanlines);

    // Build valid output PNG
    return this.buildPngBuffer(pngInfo.width, pngInfo.height, pngInfo.bitDepth, pngInfo.colorType, recompressed);
  }

  /** Build a minimal standard PNG buffer with IHDR, IDAT, and IEND chunks. */
  private buildPngBuffer(width: number, height: number, bitDepth: number, colorType: number, idat: Buffer): Buffer {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // IHDR chunk
    const ihdrPayload = Buffer.alloc(13);
    ihdrPayload.writeUInt32BE(width, 0);
    ihdrPayload.writeUInt32BE(height, 4);
    ihdrPayload[8] = bitDepth;
    ihdrPayload[9] = colorType;
    ihdrPayload[10] = 0; // compression
    ihdrPayload[11] = 0; // filter
    ihdrPayload[12] = 0; // interlace
    const ihdrChunk = this.createChunk("IHDR", ihdrPayload);

    // IDAT chunk
    const idatChunk = this.createChunk("IDAT", idat);

    // IEND chunk
    const iendChunk = this.createChunk("IEND", Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  }

  private createChunk(type: string, data: Buffer): Buffer {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, "ascii");
    data.copy(buf, 8);
    const crc = this.crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  private crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
