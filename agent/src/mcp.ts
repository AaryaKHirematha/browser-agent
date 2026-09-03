// MCP wrapper (stdio). Exposes the same browser tools over the Model Context
// Protocol so any MCP-capable agent (Claude Desktop/Code, Cursor, LangChain, …)
// gets them with zero glue. Each tool call is forwarded to the JSON-RPC server,
// which owns the extension bridge.
//
// Launch this from your MCP client config as: node <path>/dist/mcp.js
// (the server.js process must be running too).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { METHODS } from "./methods.js";

const RPC_URL = process.env.RPC_URL ?? `http://localhost:${process.env.HTTP_PORT ?? 8778}/rpc`;

let rpcId = 1;

async function callRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} — is the server running? (npm start)`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

const server = new McpServer({ name: "browser-agent", version: "0.1.0" });

for (const method of METHODS) {
  server.registerTool(
    method.name,
    { description: method.description, inputSchema: method.shape },
    async (args: Record<string, unknown>) => {
      try {
        const result = await callRpc(method.name, args ?? {});
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
        };
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] browser-agent MCP server ready (stdio)");
