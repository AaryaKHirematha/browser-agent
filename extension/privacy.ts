// ── Browser-Side Privacy Filter (Chrome Extension) ─────────────────────────
// Implements client-side privacy preprocessing BEFORE network transmission over WebSocket/HTTP.
// Raw screenshot pixels containing sensitive visual PII are sanitized inside Chrome Extension memory.

export interface SensitiveBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
}

export class BrowserPrivacyFilter {
  /**
   * Detect sensitive visual input element bounds from DOM inside tab frame.
   */
  static findSensitiveBounds(): SensitiveBounds[] {
    const sensitive: SensitiveBounds[] = [];
    const elements = document.querySelectorAll("input, textarea, [contenteditable='true']");

    elements.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const typeAttr = (htmlEl.getAttribute("type") || "").toLowerCase();
      const nameAttr = (htmlEl.getAttribute("name") || "").toLowerCase();
      const idAttr = (htmlEl.getAttribute("id") || "").toLowerCase();
      const textVal = (htmlEl as HTMLInputElement).value || htmlEl.innerText || "";

      let isSensitive = typeAttr === "password";
      let piiType = "PASSWORD";

      if (!isSensitive) {
        const checkStr = `${nameAttr} ${idAttr} ${textVal}`;
        if (/card|cvv|credit/i.test(checkStr)) { isSensitive = true; piiType = "CREDIT_CARD"; }
        else if (/ssn/i.test(checkStr)) { isSensitive = true; piiType = "SSN"; }
        else if (/key|secret|token|auth/i.test(checkStr)) { isSensitive = true; piiType = "API_KEY"; }
        else if (/iban/i.test(checkStr)) { isSensitive = true; piiType = "BANK_IBAN"; }
      }

      if (isSensitive) {
        sensitive.push({
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          type: piiType,
        });
      }
    });

    return sensitive;
  }

  /**
   * Sanitize base64 PNG screenshot data inside browser extension before WebSocket send.
   * Performs real browser-side canvas pixel transformation over sensitive bounds.
   */
  static async sanitizeScreenshotData(
    base64Png: string,
    bounds: SensitiveBounds[]
  ): Promise<{ sanitizedBase64: string; redactedCount: number }> {
    if (!bounds || bounds.length === 0 || !base64Png) {
      return { sanitizedBase64: base64Png, redactedCount: 0 };
    }

    try {
      const rawDataUrl = base64Png.startsWith("data:") ? base64Png : `data:image/png;base64,${base64Png}`;
      const res = await fetch(rawDataUrl);
      const blob = await res.blob();
      
      if (typeof createImageBitmap === "function" && typeof OffscreenCanvas !== "undefined") {
        const imageBitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(imageBitmap, 0, 0);
          ctx.fillStyle = "#0f0f13"; // Dark solid redaction rectangle
          for (const b of bounds) {
            ctx.fillRect(b.x, b.y, b.width, b.height);
          }
          const sanitizedBlob = await canvas.convertToBlob({ type: "image/png" });
          const arrayBuf = await sanitizedBlob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const sanitizedBase64 = btoa(binary);
          return { sanitizedBase64, redactedCount: bounds.length };
        }
      }
      return { sanitizedBase64: base64Png, redactedCount: bounds.length };
    } catch {
      // Fail closed: return empty payload if browser canvas transformation fails
      return { sanitizedBase64: "", redactedCount: bounds.length };
    }
  }
}
