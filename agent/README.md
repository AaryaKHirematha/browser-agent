# agent/ — the universal bridge

Exposes the browser extension to **any agent** through open standards, so you're
not locked to one LLM or framework:

- **JSON-RPC 2.0 over HTTP** — call from any language (Python, curl, JS, …)
- **MCP (Model Context Protocol)** — plug-and-play for Claude Desktop/Code,
  Cursor, LangChain, and other MCP-capable agents

Both are generated from one list of tools (`src/methods.ts`), so they never drift.

## How it fits together

```
   any agent
   ├── speaks MCP ─────▶ mcp.js (stdio) ─┐
   └── speaks HTTP ────▶ /rpc ────────────┤
                                          ▼
                              server.js  (this process)
                                          │  WebSocket  ws://localhost:8777
                                          ▼
                          Chrome extension (background.ts)
                                          │  chrome.tabs.sendMessage
                                          ▼
                                   content script → page
```

The extension **dials into** the server (an extension can't be a server), so
start the server first, then load/reload the extension.

## Run

```bash
cd agent
npm install
npm run build
npm start          # bridge ws://localhost:8777 + JSON-RPC http://localhost:8778
```

Then in Chrome, reload the extension (chrome://extensions → ↻) and reload a page.
Check the wiring:

```bash
curl localhost:8778/health      # {"ok":true,"extensionConnected":true}
curl localhost:8778/methods     # list of tools
```

## Tools

| Tool                     | Params                                       |
| ------------------------ | -------------------------------------------- |
| `browser_get_state`      | `tabId?`                                     |
| `browser_click`          | `index`, `tabId?`                            |
| `browser_type`           | `index`, `text`, `clear?`, `pressEnter?`     |
| `browser_scroll`         | `direction?`, `amount?`, `tabId?`            |
| `browser_scroll_to`      | `index`, `tabId?`                            |
| `browser_navigate`       | `url`, `tabId?`                              |
| `browser_highlight`      | `tabId?`                                     |
| `browser_clear_highlight`| `tabId?`                                     |

## Drive it over JSON-RPC (any language)

```bash
# read the page
curl -s -X POST localhost:8778/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"browser_get_state","params":{}}'

# type into element 4 and submit
curl -s -X POST localhost:8778/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"browser_type","params":{"index":4,"text":"hello","pressEnter":true}}'
```

Python:

```python
import requests
def rpc(method, **params):
    r = requests.post("http://localhost:8778/rpc",
        json={"jsonrpc":"2.0","id":1,"method":method,"params":params})
    return r.json()["result"]

state = rpc("browser_get_state")
box = next(e for e in state["elements"] if e["editable"])
rpc("browser_type", index=box["index"], text="hello", pressEnter=True)
```

## Connect an MCP client

`server.js` must be running (it owns the browser bridge). Point your MCP client at
the stdio wrapper. Example config (Claude Desktop / Claude Code style):

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "node",
      "args": ["/home/godzilaa/browser-agent/agent/dist/mcp.js"]
    }
  }
}
```

The agent then sees `browser_get_state`, `browser_click`, etc. as native tools.

## Ports

`BRIDGE_PORT` (default 8777), `HTTP_PORT` (default 8778). The MCP wrapper targets
`RPC_URL` (default `http://localhost:8778/rpc`).
