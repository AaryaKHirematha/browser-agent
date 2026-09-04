// Layer 2 + 3 types: the mutation graph and the semantic UI graph.
//
// The UI graph is NOT a database — it's a runtime state representation that
// changes hundreds/thousands of times per session. Nodes are addressed by a
// stable NodeId that survives across mutations (so deltas make sense).

import type { Rect } from "../state/types";

export type NodeId = string;

/** A node in the semantic UI graph: only what's useful for interaction. */
export interface UINode {
  id: NodeId;
  /** ARIA role, an implicit role, or a structural tag ("navigation", "form", "region", "page"). */
  role: string;
  /** Accessible name, when the element has one. */
  name?: string;
  /** Visible text, when distinct/useful. */
  text?: string;

  visible: boolean;
  enabled: boolean;
  editable: boolean;

  /** Tree structure. Parent/child is kept here; semantic (non-tree) links live as UIEdges. */
  parent?: NodeId;
  children: NodeId[];

  /** True if the agent can click/type/select this node directly. */
  interactive: boolean;
  /** Viewport-space box, when known (interactive/visible nodes). */
  rect?: Rect;

  attributes?: Record<string, string>;
}

export type EdgeRelation =
  | "child"
  | "label"
  | "controls"
  | "described-by"
  | "associated";

/** A semantic (non-tree) relationship between two nodes. */
export interface UIEdge {
  from: NodeId;
  to: NodeId;
  relation: EdgeRelation;
}

export function edgeId(e: UIEdge): string {
  return `${e.from}->${e.to}:${e.relation}`;
}

export type GraphMutationType =
  | "NODE_ADDED"
  | "NODE_REMOVED"
  | "NODE_CHANGED"
  | "EDGE_ADDED"
  | "EDGE_REMOVED";

/** Layer 2: one entry in the change log describing how the graph moved. */
export interface GraphMutation {
  type: GraphMutationType;
  nodeId: NodeId;
  /** For NODE_CHANGED: which UINode fields differ. */
  changedFields?: string[];
  /** For EDGE_ADDED / EDGE_REMOVED: the affected edge id. */
  edgeId?: string;
}

/** JSON-serializable snapshot of the whole graph. */
export interface GraphSnapshot {
  root: NodeId;
  nodes: UINode[];
  edges: UIEdge[];
}
