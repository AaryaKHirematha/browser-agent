import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { METHODS, SERVER_METHODS } from "../methods.js";
import { mcpSessionManager } from "./session.js";
import type * as http from "node:http";

export type DispatchFn = (methodName: string, params: Record<string, unknown>, sessionId: string) => Promise<unknown>;

const transports = new Map<string, SSEServerTransport>();

export async function handleSseConnect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dispatchFn: DispatchFn
) {
  const transport = new SSEServerTransport("/mcp/message", res);
  const mcpServer = new McpServer({ name: "browser-agent-remote", version: "0.2.0" });
  
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);
  
  const ALL_TOOLS = [...METHODS, ...SERVER_METHODS];
  
  for (const method of ALL_TOOLS) {
    mcpServer.registerTool(
      method.name,
      { description: method.description, inputSchema: method.shape },
      async (args: Record<string, unknown>) => {
        try {
          const result = await dispatchFn(method.name, args, sessionId);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
        }
      }
    );
  }
  
  await mcpServer.connect(transport);
  
  res.on("close", () => {
    transports.delete(sessionId);
    mcpSessionManager.endSession(sessionId);
  });
}

export async function handleSseMessage(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
  const sessionId = url.searchParams.get("sessionId");
  
  if (!sessionId) {
    res.writeHead(400);
    res.end("Missing sessionId");
    return;
  }
  
  const transport = transports.get(sessionId);
  if (!transport) {
    res.writeHead(404);
    res.end("Session not found");
    return;
  }
  
  await transport.handlePostMessage(req, res);
}
