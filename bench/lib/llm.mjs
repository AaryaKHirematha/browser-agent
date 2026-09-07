// Minimal Messages API client for benchmarking.
// Supports both Anthropic API and OpenAI-compatible API (e.g. OmniRoute).

import fs from "node:fs";
import { loadToken } from "./creds.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnv() {
  try {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../");
    const envPath = path.join(root, ".env");
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const [k, ...v] = line.split("=");
      if (k && v && process.env[k.trim()] === undefined) {
        process.env[k.trim()] = v.join("=").trim();
      }
    }
  } catch (e) {
    // ignore
  }
}
loadEnv();

export const MODEL = process.env.OPENAI_MODEL || process.env.AGENT_MODEL || "claude-opus-4-8";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const id = setTimeout(resolve, ms);
  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(signal.reason);
    }, { once: true });
  }
});

export async function fetchWithRetry(url, options, config = {}) {
  const maxRetries = config.maxRetries ?? 6;
  const baseWaitMs = config.baseWaitMs ?? (Number(process.env.LLM_BASE_WAIT_MS) || 1000);
  const timeoutMs = config.timeoutMs ?? 60000;

  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    let abortController = new AbortController();
    if (options.signal) {
      options.signal.addEventListener('abort', () => abortController.abort(options.signal.reason), { once: true });
    }
    const timeoutId = setTimeout(() => abortController.abort(new Error("Timeout")), timeoutMs);
    
    try {
      res = await fetch(url, { ...options, signal: abortController.signal });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError' && !options.signal?.aborted) {
        // This was our internal timeout
        if (attempt >= maxRetries) throw new Error("Timeout: Max retries reached.");
        await sleep(baseWaitMs * Math.pow(2, attempt), options.signal);
        continue;
      }
      if (options.signal?.aborted) throw err; // User aborted
      
      // Network error
      if (attempt >= maxRetries) throw new Error(`Network Error: Max retries reached. (${err.message})`);
      const jitter = Math.random() * 200;
      await sleep(baseWaitMs * Math.pow(2, attempt) + jitter, options.signal);
      continue;
    }

    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      if (attempt >= maxRetries) {
        throw new Error(`HTTP ${res.status}: Max retries reached.`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      let wait = Number.isFinite(retryAfter) && retryAfter > 0 
        ? retryAfter * 1000 
        : baseWaitMs * Math.pow(2, attempt);
      
      const jitter = Math.random() * 200;
      wait += jitter;
      
      await sleep(wait, options.signal);
      continue;
    }

    return res;
  }
}

function toOpenAIFormat({ system, tools, messages }) {
  const oaiMsgs = [];
  if (system) {
    oaiMsgs.push({ role: "system", content: system });
  }
  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        // Anthropic tool results format -> OpenAI format
        // In OpenAI, tool results are separate messages with role: "tool"
        for (const item of msg.content) {
          if (item.type === "tool_result") {
            oaiMsgs.push({
              role: "tool",
              tool_call_id: item.tool_use_id,
              content: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
            });
          }
        }
        if (!msg.content.some(i => i.type === "tool_result")) {
          // It's a text array
          const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("\n");
          if (text) oaiMsgs.push({ role: "user", content: text });
        }
      } else {
        oaiMsgs.push({ role: "user", content: msg.content });
      }
    } else if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("\n");
        const toolCalls = msg.content.filter(c => c.type === "tool_use").map(c => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.input) }
        }));
        const m = { role: "assistant" };
        if (text) m.content = text;
        if (toolCalls.length > 0) m.tool_calls = toolCalls;
        oaiMsgs.push(m);
      } else {
        oaiMsgs.push({ role: "assistant", content: msg.content });
      }
    }
  }

  const oaiTools = tools?.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema }
  }));

  return { messages: oaiMsgs, tools: oaiTools };
}

function parseOpenAIResponse(json) {
  if (json.error) throw new Error(json.error.message);
  const choice = json.choices[0].message;
  const content = [];
  if (choice.content) {
    content.push({ type: "text", text: choice.content });
  }
  if (choice.tool_calls) {
    for (const tc of choice.tool_calls) {
      if (tc.type === "function") {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments)
        });
      }
    }
  }
  return {
    content,
    usage: {
      input_tokens: json.usage?.prompt_tokens,
      output_tokens: json.usage?.completion_tokens
    }
  };
}

export async function createMessage({ system, tools, messages, max_tokens = 4000 }) {
  if (OPENAI_API_BASE) {
    const oaiReq = toOpenAIFormat({ system, tools, messages });
    const res = await fetchWithRetry(`${OPENAI_API_BASE.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY || "sk-local"}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: MODEL, max_tokens, ...oaiReq }),
    });
    return parseOpenAIResponse(await res.json());
  }

  // Anthropic fallback
  const token = loadToken();
  const body = { model: MODEL, max_tokens, system, tools, messages };
  if (!MODEL.includes("haiku")) body.thinking = { type: "adaptive" };

  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.type}: ${json.error.message || res.status}`);
  return json;
}
