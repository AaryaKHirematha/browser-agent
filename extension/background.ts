// Background service worker: the extension's link to the agent world.
//
// Two responsibilities:
//   1. Relay a command to the content script in a target tab (get_state/actions),
//      injecting the content script on demand if it isn't there yet.
//   2. Maintain a WebSocket connection OUT to the local bridge server, so any
//      agent (via JSON-RPC or MCP) can drive the browser. The extension can't
//      listen for connections, so it dials the server and reconnects forever.

import type { Message } from "./content";

const BRIDGE_URL = "ws://localhost:8777";
const RECONNECT_MS = 2000;

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" } as Message, { frameId: 0 });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["dist/content.js"],
    });
  }
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) return tab.id;
  const [any] = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  if (any?.id == null) throw new Error("no drivable tab");
  return any.id;
}

function waitForComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return resolve();
      } catch (e) {
        return reject(e);
      }
      if (Date.now() > deadline) return reject(new Error("navigation timed out"));
      setTimeout(poll, 200);
    };
    poll();
  });
}

// A command is either a content-script Message or a background-handled one (NAVIGATE).
type Command = Message | { type: "NAVIGATE"; url: string };

/** Execute a command against a tab (active tab if unspecified). */
export async function runCommand(cmd: Command, tabId?: number): Promise<unknown> {
  const id = tabId ?? (await activeTabId());

  if (cmd.type === "NAVIGATE") {
    await chrome.tabs.update(id, { url: cmd.url });
    await waitForComplete(id);
    await ensureContentScript(id);
    return { ok: true, url: cmd.url };
  }

  await ensureContentScript(id);
  const resp = (await chrome.tabs.sendMessage(id, cmd, { frameId: 0 })) as
    | { ok?: boolean; error?: string; state?: unknown }
    | undefined;

  // Surface content-script failures (e.g. detached element) as real errors so
  // the RPC/MCP layer reports them as errors, not successful results.
  if (resp && resp.ok === false) {
    throw new Error(resp.error ?? "command failed");
  }
  // Unwrap get_state so the result IS the page state (no { ok, state } nesting).
  if (cmd.type === "GET_STATE") return resp?.state ?? resp;
  return resp;
}

// ---- WebSocket bridge client ------------------------------------------------

let socket: WebSocket | null = null;

function connectBridge(): void {
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch {
    setTimeout(connectBridge, RECONNECT_MS);
    return;
  }

  socket.onopen = () => console.log("[browser-agent] bridge connected", BRIDGE_URL);

  socket.onmessage = async (ev) => {
    let msg: { id: number; command: Command; tabId?: number; ping?: boolean };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    // Heartbeat from the server — reply so the worker stays alive, then stop.
    if (msg.ping) {
      socket?.send(JSON.stringify({ pong: true }));
      return;
    }
    try {
      const result = await runCommand(msg.command, msg.tabId);
      socket?.send(JSON.stringify({ id: msg.id, result }));
    } catch (err) {
      socket?.send(
        JSON.stringify({ id: msg.id, error: err instanceof Error ? err.message : String(err) }),
      );
    }
  };

  socket.onclose = () => {
    socket = null;
    setTimeout(connectBridge, RECONNECT_MS);
  };
  socket.onerror = () => socket?.close();
}

connectBridge();

chrome.runtime.onInstalled.addListener(() => {
  console.log("[browser-agent] service worker installed");
});
