# browser-agent

Turn any webpage into structured JSON and let **any** agent act on it.

A Chrome (Manifest V3) extension reads the page — every visible interactive
element, each with a stable `index` — and performs actions (click, type, scroll,
navigate). A small vendor-neutral bridge exposes those as **JSON-RPC** and
**MCP** tools, so Claude, Cursor, LangChain, or a plain `curl` can all drive the
same browser.

```
   any agent
   ├── speaks MCP ──▶ mcp.js (stdio) ─┐
   └── speaks HTTP ─▶ /rpc ────────────┤
                                       ▼
                            server.js  (JSON-RPC :8778  +  WS bridge :8777)
                                       │  WebSocket
                                       ▼
                        Chrome extension (background service worker)
                                       │  chrome.tabs.sendMessage
                                       ▼
                             content script → get_state() / actions → the page
```

The extension **dials into** the bridge (an extension can't accept connections),
so the flow is: start the server → load/reload the extension → drive it.

---

## Layout

```
browser-agent/
├── extension/                 # Phase 1 — the browser layer (MV3 + TypeScript)
│   ├── manifest.json
│   ├── content.ts             # message router + index→element registry
│   ├── background.ts          # service worker; relays commands, dials WS bridge
│   ├── state/                 # get_state(): dom / geometry / visibility / types
│   └── actions/               # click / type / scroll / highlight
├── agent/                     # Phase 2 — the bridge (JSON-RPC + MCP over one WS)
│   ├── src/methods.ts         # single source of truth for the tool list
│   ├── src/server.ts          # WS bridge + JSON-RPC HTTP endpoint
│   ├── src/bridge.ts          # extension <-> server plumbing
│   └── src/mcp.ts             # stdio MCP wrapper → forwards to /rpc
├── build.mjs                  # bundles the extension into extension/dist/
└── README.md
```

---

## Install (prebuilt — for end users)

Two steps, no build tools.

1. **Add the extension.** Download `browser-agent-extension.zip` from the
   [latest release](https://github.com/Godzilaa/browser-agent/releases/latest),
   unzip it, then in Chrome: `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select the unzipped folder.
2. **Add the tool to your agent.** Drop this into your MCP client config:

   ```json
   {
     "mcpServers": {
       "browser-agent": {
         "command": "npx",
         "args": ["-y", "browser-agent-server"]
       }
     }
   }
   ```

That's it — the MCP entry **auto-starts the bridge** the extension talks to, so
there's no separate server to run.

- **Claude Code:** `claude mcp add browser-agent -- npx -y browser-agent-server`
- **Claude Desktop:** add the block to `claude_desktop_config.json`
  (Settings → Developer → Edit Config), then restart the app.
- **Cursor:** add the same block to `.cursor/mcp.json`.

The agent now has `browser_get_state`, `browser_click`, `browser_type`, … as
native tools. Open a normal `http`/`https` tab (not a `chrome://` page) and go.

> **Not on npm yet?** Until the bridge is published, use the from-source build
> below and point the MCP command at the local file instead:
> `"command": "node", "args": ["/abs/path/browser-agent/agent/dist/mcp.js"]`.

---

## Build from source

```bash
git clone https://github.com/Godzilaa/browser-agent
cd browser-agent
npm run setup          # installs + builds BOTH the extension and the bridge
```

Load the extension (`chrome://extensions` → Developer mode → Load unpacked →
`browser-agent/extension`). The MCP wrapper starts the bridge automatically; to
run it by hand instead:

```bash
cd agent && npm start   # WS bridge ws://localhost:8777 + JSON-RPC http://localhost:8778
```

Verify the wiring at any time:

```bash
curl localhost:8778/health     # {"ok":true,"extensionConnected":true}
curl localhost:8778/methods    # the tool list
```

If `extensionConnected` is `false`, reload the extension and refresh a normal
`http`/`https` tab.

---

## Publishing (maintainers)

```bash
# 1. Extension zip for a GitHub release
npm run package:ext            # → browser-agent-extension.zip

# 2. Bridge to npm (so `npx -y browser-agent-server` works for everyone)
cd agent && npm publish --access public
```

Or just push a tag — `.github/workflows/release.yml` builds the extension zip,
attaches it to a GitHub release, and (if the `NPM_TOKEN` repo secret is set)
publishes the bridge to npm:

```bash
git tag v0.1.0 && git push --tags
```

---

## Use it

### From any language (JSON-RPC)

```bash
# read the page
curl -s -X POST localhost:8778/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"browser_get_state","params":{}}'

# type into element 4 and submit
curl -s -X POST localhost:8778/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"browser_type","params":{"index":4,"text":"hello","pressEnter":true}}'
```

```python
import requests
def rpc(method, **params):
    r = requests.post("http://localhost:8778/rpc",
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    return r.json()["result"]

state = rpc("browser_get_state")
box = next(e for e in state["elements"] if e["editable"])
rpc("browser_type", index=box["index"], text="hello", pressEnter=True)
```

---

## Tools

Every tool accepts an optional `tabId` (defaults to the active tab).

| Tool                      | Params                                     | Effect                                    |
| ------------------------- | ------------------------------------------ | ----------------------------------------- |
| `browser_get_state`       | —                                          | Page → JSON (url, title, viewport, elements) |
| `browser_click`           | `index`                                    | Click element `index`                     |
| `browser_type`            | `index`, `text`, `clear?`, `pressEnter?`   | Type into an editable element             |
| `browser_scroll`          | `direction?`, `amount?`                    | Scroll up / down / top / bottom           |
| `browser_scroll_to`       | `index`                                    | Scroll element into view                  |
| `browser_navigate`        | `url`                                      | Navigate the tab, wait for load           |
| `browser_highlight`       | —                                          | Draw numbered boxes over indexed elements |
| `browser_clear_highlight` | —                                          | Remove the overlay                        |

`index` values come from the most recent `browser_get_state`. After the page
changes, call `browser_get_state` again — actions on a stale/detached element
return an error telling you to re-read.

### What `get_state()` returns

```jsonc
{
  "url": "...", "title": "...", "timestamp": 0,
  "viewport": { "width": 0, "height": 0, "scrollX": 0, "scrollY": 0, "devicePixelRatio": 1 },
  "scroll":   { "atTop": true, "atBottom": false, "maxScrollY": 0 },
  "elements": [
    { "index": 0, "tag": "button", "role": "button", "text": "Submit",
      "editable": false, "disabled": false, "inViewport": true,
      "rect": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "center": { "x": 0, "y": 0 }, "xpath": "...", "attributes": { } }
  ]
}
```

Visible interactive elements only — native controls, ARIA widgets, and
`contenteditable`, piercing open shadow DOM.

---

## Ports

`BRIDGE_PORT` (default `8777`, extension ↔ server) and `HTTP_PORT` (default
`8778`, JSON-RPC). The MCP wrapper reads `RPC_URL` (default
`http://localhost:8778/rpc`). Override via environment variables if they clash.

## Develop

```bash
npm run watch          # rebuild the extension on change
cd agent && npm run dev   # server with reload (tsx watch)
```
