#!/usr/bin/env node
// MCP wrapper (stdio). Exposes the same browser tools over the Model Context
// Protocol so any MCP-capable agent (Claude Desktop/Code, Cursor, LangChain, …)
// gets them with zero glue. Each tool call is forwarded to the JSON-RPC server,
// which owns the extension bridge.
//
// It auto-starts that bridge: if nothing is answering on the RPC port, this
// wrapper spawns server.js as a detached background process and waits for it to
// come up. So an end user only configures ONE thing — this command — and never
// has to run a separate server. Launch from your MCP client config as:
//     npx -y browser-agent-server        (or: node <path>/dist/mcp.js)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { METHODS, SERVER_METHODS } from "./methods.js";

const RPC_URL = process.env.RPC_URL ?? `http://localhost:${process.env.HTTP_PORT ?? 8778}/rpc`;
const HEALTH_URL = RPC_URL.replace(/\/rpc\/?$/, "") + "/health";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

let ensured = false;

/** Make sure the bridge server is running; start it if it isn't. */
async function ensureServer(): Promise<void> {
  if (ensured) return;
  if (await serverUp()) {
    ensured = true;
    return;
  }

  // Start the bridge detached so it outlives this MCP client and can be reused
  // by the next one (and so we don't fight the port on reconnect).
  const serverPath = fileURLToPath(new URL("./server.js", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.on("error", () => {});
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await sleep(250);
    if (await serverUp()) {
      ensured = true;
      return;
    }
  }
  // Stop waiting — if it's genuinely down (e.g. port taken by something else),
  // the first tool call will surface a clear error instead of hanging here.
  ensured = true;
}

let rpcId = 1;

async function callRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  await ensureServer();
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} — bridge server unreachable at ${RPC_URL}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

const server = new McpServer({ name: "browser-agent", version: "0.2.0" });

// Register all tools — both bridge-forwarded and server-side intelligence tools.
// The JSON-RPC server handles routing internally.
const ALL_TOOLS = [...METHODS, ...SERVER_METHODS];

for (const method of ALL_TOOLS) {
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

// Prevent process crash if stdout pipe encounters EPIPE when client resets/disconnects stdio
process.stdout.on("error", (err: unknown) => {
  const code = (err as { code?: string })?.code;
  if (code === "EPIPE" || code === "ECONNRESET") {
    // Ignore pipe closure errors on stdout
    return;
  }
  console.error("[mcp] stdout error:", err);
});

const transport = new StdioServerTransport();

transport.onclose = () => {
  console.error("[mcp] stdio transport closed");
};

transport.onerror = (err) => {
  console.error("[mcp] transport error:", err);
};

server.server.onerror = (err) => {
  console.error("[mcp] server error:", err);
};

process.on("SIGINT", () => {
  server.close().then(() => process.exit(0)).catch(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close().then(() => process.exit(0)).catch(() => process.exit(0));
});

await server.connect(transport);
console.error("[mcp] browser-agent MCP server ready (stdio) — Trustworthy Autonomous Browser Agent v0.2.0");
