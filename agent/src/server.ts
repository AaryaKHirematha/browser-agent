// Long-running server process. Hosts:
//   • the WebSocket bridge the extension connects to        (ws://localhost:8777)
//   • a JSON-RPC 2.0 endpoint any agent/language can call    (http://localhost:8778/rpc)
//   • discovery + health endpoints                           (/methods, /health)
//
// The MCP wrapper (mcp.ts) is a separate stdio process that just forwards tool
// calls to /rpc here, so MCP clients and raw HTTP clients share one browser.

import http from "node:http";
import { z } from "zod";
import { Bridge } from "./bridge.js";
import { METHODS, METHOD_MAP } from "./methods.js";

export const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8777);
export const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8778);

const bridge = new Bridge(BRIDGE_PORT);

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

async function dispatch(req: RpcRequest) {
  const id = req.id ?? null;
  const method = METHOD_MAP.get(req.method ?? "");
  if (!method) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${req.method}` } };
  }
  const parsed = z.object(method.shape).safeParse(req.params ?? {});
  if (!parsed.success) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
    };
  }
  try {
    const tabId = parsed.data.tabId as number | undefined;
    const result = await bridge.send(method.toCommand(parsed.data), tabId);
    return { jsonrpc: "2.0", id, result };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } };
  }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, extensionConnected: bridge.connected });
  }

  if (req.method === "GET" && req.url === "/methods") {
    return send(res, 200, {
      methods: METHODS.map((m) => ({
        name: m.name,
        description: m.description,
        params: Object.keys(m.shape),
      })),
    });
  }

  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let payload: RpcRequest | RpcRequest[];
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      }
      // Support JSON-RPC batches.
      const result = Array.isArray(payload)
        ? await Promise.all(payload.map(dispatch))
        : await dispatch(payload);
      return send(res, 200, result);
    });
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(HTTP_PORT, () => {
  console.error(`[rpc]    JSON-RPC on http://localhost:${HTTP_PORT}/rpc  (GET /methods, /health)`);
});
