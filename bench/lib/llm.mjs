// Minimal Claude Messages API client using the Claude Code OAuth token.
// Zero deps: raw fetch + the oauth beta header. Model held constant across the
// benchmark so the observation representation is the only variable.

import { loadToken } from "./creds.mjs";

export const MODEL = process.env.AGENT_MODEL || "claude-opus-4-8";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createMessage({ system, tools, messages, max_tokens = 4000 }) {
  const token = loadToken();
  const body = { model: MODEL, max_tokens, system, tools, messages };
  // Adaptive thinking is Opus/Sonnet 4.6+; Haiku rejects it — omit there.
  if (!MODEL.includes("haiku")) body.thinking = { type: "adaptive" };

  // Subscription tokens throttle under a rapid loop; retry 429/529 with backoff.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status === 529) && attempt < 6) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 30000);
      await sleep(wait);
      continue;
    }
    const json = await res.json();
    if (json.error) throw new Error(`${json.error.type}: ${json.error.message || res.status}`);
    return json;
  }
}
