// Incremental Graph Engine: G(t) --ΔG--> ApplyDelta --> G(t+1).
//
// Owns a UIGraph plus the element<->NodeId identity maps. build() does the
// initial full scan; applyMutations() folds a batch of DOM MutationRecords into
// the graph incrementally (add/remove/reconcile), so the graph stays in sync
// without ever rebuilding from scratch. refresh() re-derives layout-dependent
// fields (visible/enabled/rect) that mutations don't report.

import type { NodeId, UINode } from "./types";
import { UIGraph } from "./graph";
import type { Rect } from "../state/types";
import { getRect } from "../state/geometry";
import { isVisible, isDisabled } from "../state/visibility";
import {
  isInteractive,
  isEditable,
  accessibleText,
  elementRole,
  pickAttributes,
  collectAll,
  parentElementDeep,
} from "../state/semantic";

// Structural containers worth keeping even though they aren't interactive —
// they give the graph its skeleton (NAVIGATION / PRODUCT / CART …).
const LANDMARK_SELECTOR = [
  "main",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "section",
  "article",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[role=navigation]",
  "[role=main]",
  "[role=banner]",
  "[role=contentinfo]",
  "[role=complementary]",
  "[role=search]",
  "[role=form]",
  "[role=region]",
  "[role=menu]",
  "[role=menubar]",
  "[role=tablist]",
  "[role=dialog]",
  "[role=list]",
].join(",");

const HEADING = /^H[1-6]$/;

function isLandmark(el: Element): boolean {
  return !!el.matches?.(LANDMARK_SELECTOR);
}

function shouldInclude(el: Element): boolean {
  return isInteractive(el) || isLandmark(el);
}

function structuralRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  switch (el.tagName) {
    case "NAV":
      return "navigation";
    case "MAIN":
      return "main";
    case "HEADER":
      return "banner";
    case "FOOTER":
      return "contentinfo";
    case "ASIDE":
      return "complementary";
    case "FORM":
      return "form";
    case "SECTION":
      return "region";
    case "ARTICLE":
      return "article";
    default:
      return HEADING.test(el.tagName) ? "heading" : el.tagName.toLowerCase();
  }
}

/** Keep container names tight: don't dump a whole <section>'s innerText. */
function nameFor(el: Element, interactive: boolean): string | undefined {
  if (interactive) return accessibleText(el) || undefined;
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  if (HEADING.test(el.tagName)) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 120) : undefined;
  }
  return undefined;
}

/** The volatile, element-derived fields (everything except id/parent/children). */
interface Volatile {
  role: string;
  name?: string;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  interactive: boolean;
  rect?: Rect;
  attributes: Record<string, string>;
}

function deriveVolatile(el: Element): Volatile {
  const interactive = isInteractive(el);
  const role = interactive ? elementRole(el) ?? el.tagName.toLowerCase() : structuralRole(el);
  const visible = isVisible(el);
  return {
    role,
    name: nameFor(el, interactive),
    visible,
    enabled: !isDisabled(el),
    editable: isEditable(el),
    interactive,
    rect: interactive && visible ? getRect(el) : undefined,
    attributes: pickAttributes(el),
  };
}

export class IncrementalGraphEngine {
  readonly graph = new UIGraph();
  readonly rootId: NodeId = "root";

  private idByEl = new WeakMap<Element, NodeId>();
  private elById = new Map<NodeId, Element>();
  private counter = 0;

  elementFor(id: NodeId): Element | undefined {
    return this.elById.get(id);
  }

  idFor(el: Element): NodeId | undefined {
    return this.idByEl.get(el);
  }

  /** Layer 3 initial construction — full scan of the current DOM. */
  build(): void {
    this.graph.clear();
    this.idByEl = new WeakMap();
    this.elById = new Map();
    this.counter = 0;

    this.graph.addNode({
      id: this.rootId,
      role: "page",
      name: document.title || location.host,
      visible: true,
      enabled: true,
      editable: false,
      interactive: false,
      children: [],
    });

    const els = collectAll(document);
    for (const el of els) {
      if (shouldInclude(el)) this.addElement(el);
    }
    for (const el of els) {
      const id = this.idByEl.get(el);
      if (id) this.linkSemantic(el, id);
    }
    // Drop the build-time churn; callers see deltas only from here on.
    this.graph.drainMutations();
  }

  /** Layer 2 → Layer 3: fold a batch of DOM mutations into the graph. */
  applyMutations(records: MutationRecord[]): void {
    const removed: Element[] = [];
    const addedRoots: Element[] = [];
    const attrTargets = new Set<Element>();
    const textTargets = new Set<Element>();

    for (const r of records) {
      if (r.type === "childList") {
        r.removedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) removed.push(n as Element);
        });
        r.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) addedRoots.push(n as Element);
        });
      } else if (r.type === "attributes" && r.target.nodeType === Node.ELEMENT_NODE) {
        attrTargets.add(r.target as Element);
      } else if (r.type === "characterData") {
        const parent = (r.target as CharacterData).parentElement;
        if (parent) textTargets.add(parent);
      }
    }

    // 1. Removals first (also removes descendants of each removed root).
    for (const root of removed) {
      for (const el of [root, ...collectAll(root)]) {
        const id = this.idByEl.get(el);
        if (id) this.removeNodeAndUnlink(id);
      }
    }

    // 2. Additions (skip anything detached again within the same batch).
    for (const root of addedRoots) {
      if (!root.isConnected) continue;
      const fresh: Array<[Element, NodeId]> = [];
      for (const el of [root, ...collectAll(root)]) {
        if (shouldInclude(el) && !this.idByEl.has(el)) {
          const id = this.addElement(el);
          fresh.push([el, id]);
        }
      }
      for (const [el, id] of fresh) this.linkSemantic(el, id);
    }

    // 3. Attribute changes → reconcile inclusion + volatile fields.
    for (const el of attrTargets) {
      if (!el.isConnected) continue;
      this.reconcile(el);
    }

    // 4. Text changes → refresh the nearest owning node's name.
    for (const el of textTargets) {
      const owner = this.nearestOwned(el);
      if (owner) {
        const v = deriveVolatile(this.elById.get(owner)!);
        this.graph.updateNode(owner, { name: v.name });
      }
    }
  }

  /** Re-derive layout-dependent fields for every live node (call before a read). */
  refresh(): void {
    const stale: NodeId[] = [];
    for (const [id, el] of this.elById) {
      if (!el.isConnected) {
        stale.push(id);
        continue;
      }
      const v = deriveVolatile(el);
      this.graph.updateNode(id, {
        role: v.role,
        name: v.name,
        visible: v.visible,
        enabled: v.enabled,
        editable: v.editable,
        interactive: v.interactive,
        rect: v.rect,
        attributes: v.attributes,
      });
    }
    for (const id of stale) this.removeNodeAndUnlink(id);
  }

  // ---- internals ------------------------------------------------------------

  private addElement(el: Element): NodeId {
    const id = "n" + ++this.counter;
    this.idByEl.set(el, id);
    this.elById.set(id, el);

    const v = deriveVolatile(el);
    const parent = this.ancestorId(el);
    const node: UINode = {
      id,
      role: v.role,
      name: v.name,
      visible: v.visible,
      enabled: v.enabled,
      editable: v.editable,
      interactive: v.interactive,
      rect: v.rect,
      attributes: v.attributes,
      parent,
      children: [],
    };
    this.graph.addNode(node);
    this.linkChild(parent, id);
    return id;
  }

  private reconcile(el: Element): void {
    const include = shouldInclude(el);
    const id = this.idByEl.get(el);

    if (include && !id) {
      const newId = this.addElement(el);
      this.reparentUnder(el, newId);
      this.linkSemantic(el, newId);
      return;
    }
    if (include && id) {
      const v = deriveVolatile(el);
      this.graph.updateNode(id, {
        role: v.role,
        name: v.name,
        visible: v.visible,
        enabled: v.enabled,
        editable: v.editable,
        interactive: v.interactive,
        rect: v.rect,
        attributes: v.attributes,
      });
      this.linkSemantic(el, id);
      return;
    }
    if (!include && id) {
      this.removeButReparentChildren(id);
    }
  }

  /** Nearest ancestor that already has a node; else the synthetic root. */
  private ancestorId(el: Element): NodeId {
    let cur = parentElementDeep(el);
    while (cur) {
      const id = this.idByEl.get(cur);
      if (id) return id;
      cur = parentElementDeep(cur);
    }
    return this.rootId;
  }

  /** Nearest element (self or ancestor) that owns a node. */
  private nearestOwned(el: Element): NodeId | undefined {
    let cur: Element | null = el;
    while (cur) {
      const id = this.idByEl.get(cur);
      if (id) return id;
      cur = parentElementDeep(cur);
    }
    return undefined;
  }

  private linkChild(parentId: NodeId, childId: NodeId): void {
    const parent = this.graph.getNode(parentId);
    if (parent && !parent.children.includes(childId)) parent.children.push(childId);
  }

  private removeNodeAndUnlink(id: NodeId): void {
    const node = this.graph.getNode(id);
    if (node?.parent) {
      const parent = this.graph.getNode(node.parent);
      if (parent) parent.children = parent.children.filter((c) => c !== id);
    }
    const el = this.elById.get(id);
    if (el) this.idByEl.delete(el);
    this.elById.delete(id);
    this.graph.removeNode(id);
  }

  private removeButReparentChildren(id: NodeId): void {
    const node = this.graph.getNode(id);
    if (!node) return;
    const parentId = node.parent ?? this.rootId;
    const parent = this.graph.getNode(parentId);

    for (const childId of [...node.children]) {
      const child = this.graph.getNode(childId);
      if (!child) continue;
      this.graph.updateNode(childId, { parent: parentId });
      if (parent && !parent.children.includes(childId)) parent.children.push(childId);
    }
    if (parent) parent.children = parent.children.filter((c) => c !== id);
    this.removeNodeAndUnlink(id);
  }

  /** A newly-included element steals the graph-children that now sit beneath it. */
  private reparentUnder(el: Element, id: NodeId): void {
    const parentId = this.graph.getNode(id)?.parent ?? this.rootId;
    const parent = this.graph.getNode(parentId);
    if (!parent) return;
    for (const childId of [...parent.children]) {
      if (childId === id) continue;
      const childEl = this.elById.get(childId);
      if (childEl && el.contains(childEl)) {
        parent.children = parent.children.filter((c) => c !== childId);
        this.graph.updateNode(childId, { parent: id });
        this.linkChild(id, childId);
      }
    }
  }

  /** Semantic (non-tree) edges: aria-controls / describedby / labelledby / label[for]. */
  private linkSemantic(el: Element, id: NodeId): void {
    const doc = el.ownerDocument;
    const ref = (attr: string, relation: "controls" | "described-by" | "label", out: boolean) => {
      const raw = el.getAttribute(attr);
      if (!raw) return;
      for (const token of raw.split(/\s+/)) {
        const target = doc.getElementById(token);
        const tid = target && this.idByEl.get(target);
        if (!tid) continue;
        this.graph.addEdge(
          out ? { from: id, to: tid, relation } : { from: tid, to: id, relation },
        );
      }
    };
    ref("aria-controls", "controls", true);
    ref("aria-describedby", "described-by", false);
    ref("aria-labelledby", "label", false);

    if (el.tagName === "LABEL") {
      const forId = el.getAttribute("for");
      const target = forId ? doc.getElementById(forId) : null;
      const tid = target && this.idByEl.get(target);
      if (tid) this.graph.addEdge({ from: id, to: tid, relation: "label" });
    }
  }
}
