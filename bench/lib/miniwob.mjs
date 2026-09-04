// MiniWoB++ adapter: load a task, read its instruction, and read the episode
// reward — all through the extension (navigate + browser_eval in MAIN world).

import { rpc } from "./bridge.mjs";

const BASE = process.env.MINIWOB_URL || "http://localhost:8899/miniwob";

/** Navigate to a fresh task instance, start the episode, return the instruction. */
export async function startTask(task, seed) {
  const url = `${BASE}/${task}.html` + (seed != null ? `?seed=${seed}` : "");
  await rpc("browser_navigate", { url });
  // Kick off the episode timer/reward tracking if the core API is present.
  await rpc("browser_eval", {
    expression:
      "typeof core!=='undefined' && core.startEpisodeReal ? (core.startEpisodeReal(), true) : false",
  });
  const utter = await rpc("browser_eval", {
    expression:
      "(typeof core!=='undefined' && core.getUtterance) ? core.getUtterance() " +
      ": (document.getElementById('query') ? document.getElementById('query').textContent : '')",
  });
  return { url, instruction: String(utter || "").replace(/\s+/g, " ").trim() };
}

/** Read the episode outcome. done=true once the task ends; reward>0 means success. */
export async function episodeState() {
  const s = await rpc("browser_eval", {
    expression:
      "({ done: typeof WOB_DONE_GLOBAL!=='undefined' ? !!WOB_DONE_GLOBAL : false," +
      "   reward: typeof WOB_REWARD_GLOBAL!=='undefined' ? WOB_REWARD_GLOBAL : null })",
  });
  return s && typeof s === "object" ? s : { done: false, reward: null };
}
