// Layer 3 store + Layer 2 change log.
//
// UIGraph holds the in-memory nodes/edges and records a GraphMutation for every
// structural change. drainMutations() hands the delta since the last drain to
// whoever is watching (the agent), then clears it.

import type {
  NodeId,
  UINode,
  UIEdge,
  GraphMutation,
  GraphSnapshot,
} from "./types";
import { edgeId } from "./types";

// Fields that, when changed via updateNode, are worth reporting to the agent.
const TRACKED_FIELDS: (keyof UINode)[] = [
  "role",
  "name",
  "text",
  "visible",
  "enabled",
  "editable",
  "parent",
  "interactive",
];

export class UIGraph {
  nodes = new Map<NodeId, UINode>();
  edges = new Map<string, UIEdge>();

  private log: GraphMutation[] = [];

  getNode(id: NodeId): UINode | undefined {
    return this.nodes.get(id);
  }

  addNode(node: UINode): void {
    this.nodes.set(node.id, node);
    this.log.push({ type: "NODE_ADDED", nodeId: node.id });
  }

  /** Merge `changes` into a node, logging NODE_CHANGED only for fields that moved. */
  updateNode(id: NodeId, changes: Partial<UINode>): void {
    const node = this.nodes.get(id);
    if (!node) return;

    const changed: string[] = [];
    for (const key of Object.keys(changes) as (keyof UINode)[]) {
      const next = changes[key];
      if (!TRACKED_FIELDS.includes(key)) {
        // Untracked fields (rect, children, attributes) still update, silently.
        (node as any)[key] = next;
        continue;
      }
      if (!shallowEqual(node[key], next)) {
        (node as any)[key] = next;
        changed.push(key as string);
      }
    }
    if (changed.length) {
      this.log.push({ type: "NODE_CHANGED", nodeId: id, changedFields: changed });
    }
  }

  /** Remove a single node plus any edges touching it. Does not recurse. */
  removeNode(id: NodeId): void {
    if (!this.nodes.delete(id)) return;
    for (const [eid, edge] of this.edges) {
      if (edge.from === id || edge.to === id) {
        this.edges.delete(eid);
        this.log.push({ type: "EDGE_REMOVED", nodeId: id, edgeId: eid });
      }
    }
    this.log.push({ type: "NODE_REMOVED", nodeId: id });
  }

  addEdge(edge: UIEdge): void {
    const eid = edgeId(edge);
    if (this.edges.has(eid)) return;
    this.edges.set(eid, edge);
    this.log.push({ type: "EDGE_ADDED", nodeId: edge.from, edgeId: eid });
  }

  removeEdge(eid: string): void {
    const edge = this.edges.get(eid);
    if (!edge) return;
    this.edges.delete(eid);
    this.log.push({ type: "EDGE_REMOVED", nodeId: edge.from, edgeId: eid });
  }

  /** Return the mutations accumulated since the last drain, then clear them. */
  drainMutations(): GraphMutation[] {
    const out = this.log;
    this.log = [];
    return out;
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.log = [];
  }

  toJSON(root: NodeId): GraphSnapshot {
    return {
      root,
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    };
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}
