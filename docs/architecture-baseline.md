# Architecture Baseline — browser-agent

> Phase 0 audit, captured before any Trustworthy Autonomous Browser Agent work begins.

---

## 1. Repository Structure

```
browser-agent/
├── extension/                   # Chrome MV3 browser layer (TypeScript)
│   ├── manifest.json            # MV3 manifest: scripting + tabs + activeTab + <all_urls>
│   ├── content.ts               # Message router, index→Element registry, graph entry
│   ├── background.ts            # Service worker: WS bridge client, NAVIGATE, EVAL
│   ├── state/                   # get_state() observation pipeline
│   │   ├── types.ts             # PageState, InteractiveElement, Rect, Point
│   │   ├── dom.ts               # extractState(): find + serialize interactive elements
│   │   ├── semantic.ts          # INTERACTIVE_SELECTOR, collectAll, accessibleText, elementRole
│   │   ├── geometry.ts          # getRect, centerOf, inViewport, scrollMetrics
│   │   └── visibility.ts        # isVisible, isDisabled, isHittable
│   ├── graph/                   # Semantic UI graph (Layers 2+3)
│   │   ├── types.ts             # NodeId, UINode, UIEdge, GraphMutation, GraphSnapshot
│   │   ├── graph.ts             # UIGraph store + mutation log + drainMutations
│   │   ├── engine.ts            # IncrementalGraphEngine: build/applyMutations/refresh
│   │   ├── observer.ts          # DomObserver: MutationObserver + coalesced flush
│   │   └── project.ts           # project(): task-conditioned projection → agent view
│   ├── actions/                 # Browser action implementations
│   │   ├── click.ts             # clickElement: pointer/mouse event sequence
│   │   ├── type.ts              # typeText: native value setter + input/change events
│   │   ├── scroll.ts            # scrollPage + scrollToElement
│   │   └── highlight.ts         # Debug overlay: draw/clear numbered boxes
│   └── dist/                    # esbuild output (content.js, background.js)
├── agent/                       # Bridge server (JSON-RPC + MCP)
│   ├── src/
│   │   ├── methods.ts           # Tool definitions (name, shape, toCommand)
│   │   ├── server.ts            # HTTP server: /rpc, /health, /methods
│   │   ├── bridge.ts            # WebSocket bridge: extension ↔ server correlation
│   │   └── mcp.ts               # MCP stdio wrapper: auto-starts server, forwards calls
│   ├── test.mjs                 # E2E smoke test
│   ├── dist/                    # tsc output
│   └── package.json             # browser-agent-server (publishable)
├── bench/                       # Benchmark harness
│   ├── obsbench.mjs             # Observation-size benchmark (no LLM)
│   ├── run.mjs                  # MiniWoB++ runner (modes × tasks × seeds)
│   ├── loop.mjs                 # Instrumented agent loop per episode
│   ├── lib/
│   │   ├── bridge.mjs           # JSON-RPC client
│   │   ├── llm.mjs              # Claude Messages API client
│   │   ├── miniwob.mjs          # MiniWoB++ adapter (navigate, read reward)
│   │   └── creds.mjs            # Claude Code OAuth token loader
│   └── results/                 # Benchmark output JSON files
├── build.mjs                    # esbuild config for extension
├── package.json                 # Root: extension build + typecheck
├── tsconfig.json                # Root TypeScript config
└── docs/
    ├── observation-benchmark.md # Benchmark writeup
    └── linkedin-post.md         # Social media post
```

---

## 2. Architecture Data Flow

```
User / LLM agent
    │
    ├── MCP (stdio) ──▶ mcp.ts ──▶ callRpc() ──▶ HTTP POST /rpc
    │                                                │
    └── Direct HTTP ──▶ server.ts ──────────────────┤
                                                     │
                                  dispatch() validates params (Zod)
                                  bridge.send(command, tabId)
                                                     │
                                          WebSocket :8777
                                                     │
                                          background.ts (service worker)
                                           ├── NAVIGATE → chrome.tabs.update
                                           ├── EVAL     → chrome.scripting.executeScript (MAIN)
                                           └── others   → chrome.tabs.sendMessage
                                                             │
                                                   content.ts (content script)
                                                    handle(msg)
                                                     ├── GET_STATE  → extractState()
                                                     ├── GET_GRAPH  → getGraph()
                                                     ├── GRAPH_DELTA→ getGraphDelta()
                                                     ├── GET_UI_GRAPH→getUiGraph()
                                                     ├── CLICK      → clickElement()
                                                     ├── TYPE       → typeText()
                                                     ├── SCROLL     → scrollPage()
                                                     ├── SCROLL_TO  → scrollToElement()
                                                     ├── HIGHLIGHT  → drawHighlights()
                                                     ├── CLEAR_HIGHLIGHT→clearHighlights()
                                                     ├── DOM_STATS  → raw DOM metrics
                                                     └── PING       → { ok, frame }
```

---

## 3. Current Capabilities

### Observation
| Tool | Description | Layer |
|------|-------------|-------|
| `browser_get_state` | Flat list of visible interactive elements with index, rect, role, text, xpath | State |
| `browser_get_graph` | Task-conditioned semantic UI tree with query/roles filtering | Graph (L3) |
| `browser_graph_delta` | Mutations since last read (NODE_ADDED/REMOVED/CHANGED, EDGE_*) | Graph (L2) |
| `browser_ui_graph` | Full raw semantic graph (all nodes + edges) | Graph (raw) |
| `browser_dom_stats` | Raw DOM size metrics (htmlChars, nodes, innerTextChars) | DOM |

### Actions
| Tool | Description |
|------|-------------|
| `browser_click` | Pointer + mouse event sequence + native click |
| `browser_type` | Native value setter + input/change events, React-compatible |
| `browser_scroll` | Page-level scroll (up/down/top/bottom) |
| `browser_scroll_to` | Scroll element into view (centered) |
| `browser_navigate` | Navigate tab + wait for complete |
| `browser_eval` | Evaluate JS in MAIN world |
| `browser_highlight` | Debug overlay with numbered boxes |
| `browser_clear_highlight` | Remove debug overlay |

### Infrastructure
- **MCP**: stdio transport, auto-starts bridge server
- **JSON-RPC 2.0**: HTTP endpoint with batch support
- **WebSocket bridge**: Request/response correlation with timeout
- **Extension**: MV3 service worker with heartbeat keep-alive
- **Content script**: Top-frame only, index→Element registry
- **Shadow DOM**: Pierces open shadow roots
- **Build**: esbuild for extension, tsc for agent

---

## 4. Current Limitations

| Area | Limitation |
|------|-----------|
| **Observation** | No visual/screenshot capability — text-only |
| **Planning** | No task understanding or multi-step planning |
| **Risk** | No risk assessment — all actions execute immediately |
| **Policy** | No domain/action restrictions |
| **Approval** | No human-in-the-loop for dangerous actions |
| **Verification** | No post-action verification |
| **Recovery** | Stale elements error out; no automatic re-observation or retry |
| **Privacy** | No sensitive data detection or redaction |
| **Memory** | No cross-action task memory or session state |
| **Audit** | No structured audit log |
| **Security** | No prompt injection defense; webpage content is trusted |
| **Frames** | Top frame only; iframes not aggregated |
| **Errors** | Generic error messages; no structured error classification |
| **Permissions** | `<all_urls>` host permission; no per-domain restrictions |

---

## 5. Existing APIs

### HTTP Endpoints (port 8778)
- `GET /health` → `{ ok: boolean, extensionConnected: boolean }`
- `GET /methods` → `{ methods: [{ name, description, params }] }`
- `POST /rpc` → JSON-RPC 2.0 request/response (batches supported)

### WebSocket Bridge (port 8777)
- Server → Extension: `{ id, command, tabId? }`
- Extension → Server: `{ id, result? } | { id, error? }`
- Heartbeat: server sends `{ ping: true }` every 15s

### Extension Messages
- Background → Content: `Message` type (discriminated union on `type`)
- Content → Background: synchronous response via `sendResponse`

---

## 6. Security Assumptions (Current)

1. **Localhost only**: Both WS (:8777) and HTTP (:8778) bind to localhost
2. **No authentication**: Any local process can call /rpc
3. **No TLS**: All communication is plaintext over localhost
4. **No rate limiting**: No throttling on any endpoint
5. **Full browser access**: `<all_urls>` + scripting permission
6. **MAIN world eval**: `browser_eval` can run arbitrary JS in page context
7. **No input validation on eval**: Any expression is executed
8. **CORS**: `access-control-allow-origin: *` on /rpc responses
9. **No CSP for extension**: Extension pages have no Content Security Policy
10. **Trust model**: All input (user, MCP, webpage content) is implicitly trusted

---

## 7. Observation Architecture

### Layer 1: Raw DOM
- `extractState()` in `state/dom.ts`
- Finds elements matching INTERACTIVE_SELECTOR
- Filters by visibility (style + box checks)
- Produces flat `InteractiveElement[]` with index, tag, role, text, rect, xpath

### Layer 2: Graph Delta
- MutationObserver → coalesced batches → `applyMutations()`
- Tracks NODE_ADDED, NODE_REMOVED, NODE_CHANGED, EDGE_ADDED, EDGE_REMOVED
- `drainMutations()` returns and clears the delta since last read

### Layer 3: Semantic UI Graph
- `IncrementalGraphEngine`: builds UIGraph from DOM
- Nodes: interactive elements + landmarks (nav, header, form, headings, etc.)
- Edges: aria-controls, aria-describedby, aria-labelledby, label[for]
- `refresh()`: re-derives layout-dependent fields (visible, rect, enabled)
- `project()`: task-conditioned filtering → compact tree for agent

### Shared Registry
- `registry: Element[]` in content.ts
- Both `getState()` and `getGraph()` update the same registry
- Actions resolve `index` → `Element` from this registry
- Stale/detached elements throw errors

---

## 8. Benchmark Architecture

### Observation Benchmark (`obsbench.mjs`)
- Compares raw HTML vs flat (get_state) vs graph (get_graph) on real pages
- Measures: chars, estimated tokens (~chars/4), DOM nodes, extraction latency
- Reports compression ratios (raw/graph, raw/flat)

### Agent Benchmark (`run.mjs` + `loop.mjs`)
- MiniWoB++ tasks with Claude as the agent
- Modes: `graph` (semantic projection) vs `flat` (interactive list)
- Metrics: success rate, steps, observation chars, prompt/output tokens, wall time
- Aggregate table across tasks × seeds × modes

### Test Infrastructure
- `test.mjs`: E2E smoke test against active tab
- Exercises: health, navigate, get_state, highlight, scroll, clear_highlight

---

## 9. Build System

### Extension
- **Tool**: esbuild
- **Format**: IIFE (required for content scripts)
- **Entry points**: content.ts, background.ts
- **Output**: extension/dist/
- **Config**: build.mjs

### Agent Server
- **Tool**: TypeScript compiler (tsc)
- **Module**: NodeNext (ESM)
- **Output**: agent/dist/
- **Dependencies**: @modelcontextprotocol/sdk, ws, zod

---

## 10. Key Interfaces (TypeScript)

### PageState (state/types.ts)
```typescript
interface PageState {
  url, title, timestamp,
  viewport: { width, height, scrollX, scrollY, devicePixelRatio },
  scroll: { atTop, atBottom, maxScrollY },
  elements: InteractiveElement[]
}
```

### UINode (graph/types.ts)
```typescript
interface UINode {
  id: NodeId, role, name?, text?,
  visible, enabled, editable, interactive,
  parent?, children: NodeId[],
  rect?, attributes?
}
```

### Method (methods.ts)
```typescript
interface Method {
  name: string,
  description: string,
  shape: Record<string, ZodTypeAny>,
  toCommand: (args) => Record<string, any>
}
```
