// Shared types for the browser layer.
// The content script produces a PageState (JSON-serializable) that the agent consumes.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** One interactive element the agent can act on, addressed by `index`. */
export interface InteractiveElement {
  /** Stable-per-snapshot handle. Actions reference this. */
  index: number;
  tag: string;
  /** Explicit or implicit ARIA role, when known. */
  role: string | null;
  /** input/button `type` attribute, when present. */
  type: string | null;
  /** Best-effort accessible label / visible text. */
  text: string;
  value: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  href: string | null;
  /** True for inputs/textareas/contenteditable — the agent may type here. */
  editable: boolean;
  disabled: boolean;
  /** Fully or partially inside the current viewport. */
  inViewport: boolean;
  /** Bounding box in viewport (CSS px) coordinates. */
  rect: Rect;
  /** Click target — center of the visible box. */
  center: Point;
  /** Best-effort XPath for debugging / re-location. */
  xpath: string;
  /** A subset of attributes useful for disambiguation. */
  attributes: Record<string, string>;
}

export interface PageState {
  url: string;
  title: string;
  /** ms since epoch when the snapshot was taken. */
  timestamp: number;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
  scroll: {
    atTop: boolean;
    atBottom: boolean;
    /** Max scrollable Y offset of the document. */
    maxScrollY: number;
  };
  /** Interactive elements in document order. */
  elements: InteractiveElement[];
}
