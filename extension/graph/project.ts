// Task-conditioned projection: Semantic UI Graph → the small tree the agent sees.
//
// Keeps only interaction-useful nodes (visible interactive elements) plus the
// structural ancestors that give them context, optionally filtered by a task
// query / role set and capped in size. Assigns each interactive node a compact
// `index` the action tools can target.

import type { NodeId, UINode } from "./types";
import type { IncrementalGraphEngine } from "./engine";

export interface ProjectOptions {
  /** Free-text task hint; keeps interactive nodes whose name/text/role/attrs match all terms. */
  query?: string;
  /** Restrict to these roles (e.g. ["button","link"]). */
  roles?: string[];
  /** Include not-currently-visible interactive nodes too. Default false. */
  includeInvisible?: boolean;
  /** Max interactive nodes to keep. Default 200. */
  maxNodes?: number;
}

export interface ProjectedNode {
  id: NodeId;
  role: string;
  name?: string;
  interactive: boolean;
  enabled: boolean;
  /** Action handle for interactive nodes; set on the aligned element list. */
  index?: number;
  children: ProjectedNode[];
}

export interface Projection {
  tree: ProjectedNode | null;
  /** Indented, LLM-friendly rendering of `tree`. */
  text: string;
  /** Count of interactive nodes exposed. */
  count: number;
  /** True if `maxNodes` clipped the interactive set. */
  truncated: boolean;
  /** index → element handle, so the caller can wire up the action registry. */
  elements: Element[];
}

/** Relevance score: how many task terms this node matches (OR, ranked). 0 = drop. */
function queryScore(n: UINode, terms: string[]): number {
  if (!terms.length) return 1; // no task hint → everything is equally in
  const hay = [n.name, n.text, n.role, ...Object.values(n.attributes ?? {})]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const t of terms) if (hay.includes(t)) score++;
  return score;
}

export function project(engine: IncrementalGraphEngine, opts: ProjectOptions = {}): Projection {
  const { query, roles, includeInvisible = false, maxNodes = 200 } = opts;
  const nodes = engine.graph.nodes;
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const roleSet = roles && roles.length ? new Set(roles) : null;

  // Candidate interactive leaves, tagged with relevance and document order.
  const candidates: Array<{ id: NodeId; score: number; order: number }> = [];
  let order = 0;
  for (const n of nodes.values()) {
    order++;
    if (!n.interactive) continue;
    if (!includeInvisible && !n.visible) continue;
    if (roleSet && !roleSet.has(n.role)) continue;
    const score = queryScore(n, terms);
    if (score === 0) continue; // matched no task term → drop
    candidates.push({ id: n.id, score, order: order - 1 });
  }
  // Rank by relevance (desc), stable on document order, then cap. The kept set
  // is the most task-relevant nodes; the tree still renders in document order.
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  const truncated = candidates.length > maxNodes;
  const kept = new Set<NodeId>(candidates.slice(0, maxNodes).map((c) => c.id));

  // Pull in the ancestor chain of every kept leaf for context.
  for (const id of [...kept]) {
    let p = nodes.get(id)?.parent;
    while (p) {
      kept.add(p);
      p = nodes.get(p)?.parent;
    }
  }
  kept.add(engine.rootId);

  const elements: Element[] = [];
  let nextIndex = 0;

  const buildTree = (id: NodeId): ProjectedNode | null => {
    const n = nodes.get(id);
    if (!n || !kept.has(id)) return null;

    const children: ProjectedNode[] = [];
    for (const childId of n.children) {
      const child = buildTree(childId);
      if (child) children.push(child);
    }

    // Drop structural containers that ended up empty after filtering.
    if (!n.interactive && children.length === 0 && id !== engine.rootId) return null;

    const node: ProjectedNode = {
      id: n.id,
      role: n.role,
      name: n.name,
      interactive: n.interactive,
      enabled: n.enabled,
      children,
    };
    if (n.interactive) {
      const el = engine.elementFor(id);
      if (el) {
        node.index = nextIndex++;
        elements.push(el);
      }
    }
    return node;
  };

  const tree = buildTree(engine.rootId);
  return {
    tree,
    text: tree ? render(tree, 0).join("\n") : "(empty)",
    count: elements.length,
    truncated,
    elements,
  };
}

function render(node: ProjectedNode, depth: number): string[] {
  const pad = "  ".repeat(depth);
  let line = pad + node.role.toUpperCase();
  if (node.name) line += ` "${node.name}"`;
  if (node.interactive && node.index != null) line += ` [#${node.index}]`;
  if (node.interactive && !node.enabled) line += " (disabled)";
  const lines = [line];
  for (const child of node.children) lines.push(...render(child, depth + 1));
  return lines;
}
