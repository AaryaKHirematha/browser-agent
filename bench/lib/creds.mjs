// Read the Claude Code OAuth token at runtime. Never copied elsewhere or logged.
import fs from "node:fs";

export function loadToken() {
  const path = process.env.HOME + "/.claude/.credentials.json";
  const c = JSON.parse(fs.readFileSync(path, "utf8"));
  const o = c.claudeAiOauth || c;
  if (!o.accessToken) throw new Error("no accessToken in ~/.claude/.credentials.json");
  if (o.expiresAt && o.expiresAt < Date.now()) {
    throw new Error("Claude Code token expired — open Claude Code to refresh it, then rerun");
  }
  return o.accessToken;
}
