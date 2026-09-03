// WebSocket bridge to the Chrome extension.
//
// The extension can't be a server, so IT connects to US. This class runs the WS
// server, tracks the (single) extension connection, and does request/response
// correlation by id: send a command, get a promise that resolves with the
// extension's reply.

import { WebSocketServer, WebSocket } from "ws";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class Bridge {
  private wss: WebSocketServer;
  private ext: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (ws) => {
      // Newest connection wins (handles the extension reloading).
      this.ext = ws;
      console.error(`[bridge] extension connected`);
      // Heartbeat: an inbound message every <30s keeps the MV3 service worker
      // alive, so an idle bridge doesn't get torn down.
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: true }));
      }, 15000);
      ws.on("message", (data) => this.onMessage(data.toString()));
      ws.on("close", () => {
        clearInterval(heartbeat);
        if (this.ext === ws) this.ext = null;
        console.error(`[bridge] extension disconnected`);
      });
      ws.on("error", () => {});
    });
    this.wss.on("listening", () => console.error(`[bridge] listening on ws://localhost:${port}`));
    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Another bridge already owns this port — that's fine, defer to it.
        console.error(`[bridge] ws port ${port} already in use; another bridge is running — exiting.`);
        process.exit(0);
      }
      console.error("[bridge] websocket server error:", err.message);
    });
  }

  get connected(): boolean {
    return !!this.ext && this.ext.readyState === WebSocket.OPEN;
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  }

  /** Send a command message to the extension and await its reply. */
  send(command: Record<string, unknown>, tabId?: number, timeoutMs = 20000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("extension not connected — load the extension and reload a page"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ext!.send(JSON.stringify({ id, command, tabId }));
    });
  }
}
