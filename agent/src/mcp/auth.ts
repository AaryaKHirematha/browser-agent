import * as crypto from "node:crypto";
import type * as http from "node:http";

export function getMcpToken(): string | null {
  return process.env.BROWSER_AGENT_MCP_TOKEN ?? null;
}

export function isAuthenticated(req: http.IncomingMessage): boolean {
  const token = getMcpToken();

  if (!token) {
    if (process.env.BROWSER_AGENT_ALLOW_UNAUTHENTICATED_LOCALHOST === "true") {
      const isLocalhost =
        req.socket.remoteAddress === "127.0.0.1" ||
        req.socket.remoteAddress === "::1" ||
        req.socket.remoteAddress === "::ffff:127.0.0.1";
      if (isLocalhost) return true;
    }
    return false;
  }

  // Parse URL to allow token as a query parameter (some MCP clients prefer this)
  let queryToken: string | null = null;
  if (req.url) {
    try {
      // Need full URL to parse search params easily, host doesn't matter here
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      queryToken = url.searchParams.get("token");
    } catch {
      // ignore
    }
  }

  const authHeader = req.headers.authorization;
  let providedToken: string | null = null;

  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) providedToken = match[1];
  } else if (queryToken) {
    providedToken = queryToken;
  }

  if (!providedToken) return false;

  try {
    const expectedBuffer = Buffer.from(token, "utf8");
    const providedBuffer = Buffer.from(providedToken, "utf8");
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}
