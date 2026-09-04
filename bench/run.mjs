// Benchmark runner: sweeps tasks × seeds × observation-modes, logs per-episode
// metrics, and prints an aggregate table. Results are also written to
// bench/results/run-<epoch>.json.
//
// Usage:
//   node bench/run.mjs
//   BENCH_MODES=graph,flat BENCH_TASKS=click-button,enter-text BENCH_SEEDS=0,1 node bench/run.mjs
//
// Preconditions: the (rebuilt) bridge is running with the extension connected,
// the MiniWoB server is up on :8899, and the Claude Code token is valid.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEpisode } from "./loop.mjs";
import { MODEL } from "./lib/llm.mjs";

const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");

const list = (env, def) => (process.env[env] ? process.env[env].split(",").map((s) => s.trim()) : def);

const TASKS = list("BENCH_TASKS", [
  "click-test-2",
  "click-button",
  "focus-text",
  "enter-text",
  "click-link",
  "click-dialog",
]);
const SEEDS = list("BENCH_SEEDS", ["0"]).map(Number);
const MODES = list("BENCH_MODES", ["graph", "flat"]);
const MAX_STEPS = Number(process.env.BENCH_MAX_STEPS || 15);

function aggregate(rows, mode) {
  const r = rows.filter((x) => x.mode === mode);
  if (!r.length) return null;
  const n = r.length;
  const avg = (f) => Math.round((r.reduce((s, x) => s + f(x), 0) / n) * 10) / 10;
  return {
    mode,
    episodes: n,
    successRate: Math.round((r.filter((x) => x.success).length / n) * 100),
    avgSteps: avg((x) => x.steps),
    avgObsChars: avg((x) => x.avgObsChars),
    avgPromptTokens: avg((x) => x.promptTokens),
    avgOutputTokens: avg((x) => x.outputTokens),
    avgMs: avg((x) => x.ms),
  };
}

function table(aggs) {
  const cols = [
    ["mode", 8],
    ["episodes", 9],
    ["success%", 9],
    ["avgSteps", 9],
    ["obsChars", 9],
    ["promptTok", 10],
    ["outTok", 8],
    ["ms", 7],
  ];
  const head = cols.map(([c, w]) => c.padEnd(w)).join(" ");
  const rows = aggs.map((a) =>
    [a.mode, a.episodes, a.successRate, a.avgSteps, a.avgObsChars, a.avgPromptTokens, a.avgOutputTokens, a.avgMs]
      .map((v, i) => String(v).padEnd(cols[i][1]))
      .join(" "),
  );
  return [head, "-".repeat(head.length), ...rows].join("\n");
}

async function main() {
  console.error(`model: ${MODEL} | modes: ${MODES.join(", ")} | tasks: ${TASKS.length} | seeds: ${SEEDS.join(",")}\n`);
  const rows = [];
  for (const mode of MODES) {
    for (const task of TASKS) {
      for (const seed of SEEDS) {
        try {
          rows.push(await runEpisode({ task, seed, mode, maxSteps: MAX_STEPS, onEvent: (l) => console.error(l) }));
        } catch (err) {
          console.error(`  ⚠️ ${task} [${mode}] errored: ${err instanceof Error ? err.message : err}`);
          rows.push({ task, seed, mode, model: MODEL, success: false, error: String(err), steps: 0, promptTokens: 0, outputTokens: 0, observeCalls: 0, avgObsChars: 0, ms: 0 });
        }
      }
    }
  }

  const aggs = MODES.map((m) => aggregate(rows, m)).filter(Boolean);
  console.error("\n=== AGGREGATE ===\n" + table(aggs) + "\n");

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = Date.now();
  const out = path.join(RESULTS_DIR, `run-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, tasks: TASKS, seeds: SEEDS, modes: MODES, aggregate: aggs, episodes: rows }, null, 2));
  console.error(`written: ${out}`);
}

main().catch((e) => {
  console.error("fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
