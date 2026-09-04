# browser-agent

A Chrome (Manifest V3) extension that lets **any** agent read and act on the
page **in your real, logged-in browser** — exposed over **MCP** and **JSON-RPC**
so Claude, Cursor, LangChain, or plain `curl` all drive the same tab. It ships
with two things most agents in this space skip: a **semantic UI-graph**
observation layer (kept live by a MutationObserver) and a **benchmark harness**
that measures what it costs to feed a page to an LLM.

> **Honest positioning.** This is a well-trodden category — see
> [Prior art](#prior-art--where-this-sits). It is not novel technology; it's a
> clean, measured implementation and a small study. If you want a production
> agent, look at [browser-use](https://github.com/browser-use/browser-use) or
> [real-browser-mcp](https://github.com/ofershap/real-browser-mcp). If you want
> to understand *how observation representation affects cost*, read the
> [benchmark writeup](docs/observation-benchmark.md).

```
   any agent
   ├── speaks MCP ──▶ mcp.js (stdio) ─┐
   └── speaks HTTP ─▶ /rpc ────────────┤
                                       ▼
                            server.js  (JSON-RPC :8778  +  WS bridge :8777)
                                       │  WebSocket (localhost only)
                                       ▼
                        Chrome extension (background service worker)
                                       │  chrome.tabs.sendMessage / chrome.scripting
                                       ▼
             content script → get_state() · UI graph · actions → the page
```

The extension **dials into** the bridge (an extension can't accept
connections): start the server → load/reload the extension → drive it.

---

## Layout

```
browser-agent/
├── extension/                 # the browser layer (MV3 + TypeScript)
│   ├── manifest.json
│   ├── content.ts             # message router + index→element registry
│   ├── background.ts          # service worker; relays commands, dials WS bridge, MAIN-world eval
│   ├── state/                 # get_state(): dom / geometry / visibility / semantic / types
│   ├── graph/                 # semantic UI graph: types / graph / observer / engine / project
│   └── actions/               # click / type / scroll / highlight
├── agent/                     # the bridge (JSON-RPC + MCP over one WS)
│   └── src/{methods,server,bridge,mcp}.ts
├── bench/                     # benchmark harness (see docs/observation-benchmark.md)
│   ├── obsbench.mjs           # observation-size comparison (raw HTML vs flat vs graph)
│   ├── run.mjs / loop.mjs     # MiniWoB++ agent runner, observation-mode ablation
│   └── lib/                   # creds / llm / bridge / miniwob
├── build.mjs
└── docs/observation-benchmark.md
```

---

## Install (prebuilt)

1. **Add the extension.** Download `browser-agent-extension.zip` from the
   [latest release](https://github.com/Godzilaa/browser-agent/releases/latest),
   unzip, then `chrome://extensions` → **Developer mode** → **Load unpacked** →
   pick the folder.
2. **Point your agent at it** via MCP:
   ```json
   { "mcpServers": { "browser-agent": { "command": "npx", "args": ["-y", "browser-agent-server"] } } }
   ```
   - **Claude Code:** `claude mcp add browser-agent -- npx -y browser-agent-server`
   - **Claude Desktop / Cursor:** add the block to the client's MCP config.

Open a normal `http`/`https` tab (not `chrome://`) and go.

> **Not on npm yet.** Use the from-source build below and point the MCP command
> at the local file: `"command": "node", "args": ["/abs/path/agent/dist/mcp.js"]`.

## Build from source

```bash
git clone https://github.com/Godzilaa/browser-agent && cd browser-agent
npm run setup            # installs + builds the extension AND the bridge
cd agent && npm start    # WS bridge :8777 + JSON-RPC :8778 (or let the MCP wrapper auto-start it)
```
Load `extension/` unpacked. Verify: `curl localhost:8778/health` →
`{"ok":true,"extensionConnected":true}`.

---

## Tools

Every tool takes an optional `tabId` (defaults to the active tab).

| Tool | Params | Effect |
| --- | --- | --- |
| `browser_get_state` | — | Page → JSON: flat list of visible interactive elements, each with an `index` |
| `browser_get_graph` | `query?`, `roles?`, `maxNodes?` | Page → **semantic UI tree** (task-conditioned projection), interactive nodes tagged `[#index]` |
| `browser_graph_delta` | — | Mutations since last call (NODE_ADDED/REMOVED/CHANGED, EDGE_ADDED/REMOVED) |
| `browser_ui_graph` | — | Full raw semantic graph (nodes + semantic edges) |
| `browser_click` | `index` | Click element `index` |
| `browser_type` | `index`, `text`, `clear?`, `pressEnter?` | Type into an editable element |
| `browser_scroll` / `browser_scroll_to` | `direction?` / `index` | Scroll page / element into view |
| `browser_navigate` | `url` | Navigate the tab, wait for load |
| `browser_eval` | `expression` | Eval a JS expression in the page's MAIN world (reads site globals; blocked by strict CSP) |
| `browser_dom_stats` | — | Raw-DOM size metrics from the isolated world (CSP-immune) |
| `browser_highlight` / `browser_clear_highlight` | — | Debug overlay of indexed elements |

`index` values come from the most recent `get_state`/`get_graph`. After the page
changes, read again — actions on a stale/detached element error out.

## Observation layers

- **`get_state`** — a flat list of visible interactive elements (native controls,
  ARIA widgets, `contenteditable`), piercing open shadow DOM.
- **`get_graph`** — a **semantic UI graph** built once and kept live by a
  MutationObserver (`extension/graph/`). Interactive elements + landmark/heading
  containers collapse the raw DOM into a small tree; `project()` filters it to
  the task (`query`) and hands out `[#index]` action handles.
- **`graph_delta`** — Layer 2: what *changed* since your last read, instead of
  re-serializing the whole page.

See [docs/observation-benchmark.md](docs/observation-benchmark.md) for how these
compare on real pages (spoiler: semantic ≫ raw HTML on tokens; graph ≈ flat).

---

## Prior art & where this sits

The idea — feed an LLM a distilled, indexed view of the page and let it act, in
the user's real browser, over MCP — is **not new**. Closely overlapping projects:

- **[browser-use](https://github.com/browser-use/browser-use)** — the default
  open-source web-agent framework (100k★, WebVoyager SOTA).
- **[real-browser-mcp](https://github.com/ofershap/real-browser-mcp)**,
  **[BrowserMCP](https://github.com/Smotree/BrowserMCP)**,
  **[browser-control-mcp](https://github.com/eyalzh/browser-control-mcp)** —
  MCP + extension driving your real, logged-in browser over localhost WebSocket
  (same architecture as this repo).
- **Agent-Browser (Vercel), Agent-E, Notte** — token-efficient
  "distilled DOM / snapshot+refs" observations (same idea as the graph/flat view).
- Incremental-observation research (Region4Web, Signal-Driven Observation)
  covers the `graph_delta` concept.

What this repo offers that many of the above don't: an in-repo **benchmark
harness** and an honest **measurement** of the representation tradeoff.

---

## Ports & develop

`BRIDGE_PORT` (8777, extension ↔ server), `HTTP_PORT` (8778, JSON-RPC); MCP
wrapper reads `RPC_URL`. `npm run watch` (extension), `cd agent && npm run dev`
(server with reload).
