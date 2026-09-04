// Observation-size benchmark (no LLM). For a corpus of real, complex pages,
// measure the size of the observation each representation would feed the model:
//
//   raw   : document.documentElement.outerHTML         (naive HTML-agent baseline)
//   flat  : browser_get_state condensed to [#i] lines  (flat interactive list)
//   graph : browser_get_graph projection text          (our semantic UI tree)
//
// This is where the projection's value shows: pruning a large DOM to
// interaction-useful nodes. Reports chars, est. tokens (~chars/4), element
// counts, and extraction latency. Saves results/obs-<epoch>.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rpc } from "./lib/bridge.mjs";

const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");

const URLS = process.env.OBS_URLS
  ? process.env.OBS_URLS.split(",").map((s) => s.trim())
  : [
      "https://en.wikipedia.org/wiki/Web_scraping",
      "https://news.ycombinator.com/",
      "https://github.com/trending",
      "https://www.bbc.com/news",
      "https://www.demoblaze.com/",
      "https://developer.mozilla.org/en-US/docs/Web/HTML",
    ];

const estTokens = (s) => Math.round(s.length / 4);

async function timed(fn) {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

function flatText(state) {
  return (state.elements || [])
    .map((e) => {
      const label = e.role || e.tag;
      const text = e.text ? ` "${e.text}"` : "";
      const edit = e.editable ? " (editable)" : "";
      return `[#${e.index}] ${label}${text}${edit}`;
    })
    .join("\n");
}

// browser_navigate can resolve on the previous page's stale "complete" status,
// so poll until the DOM is actually populated before measuring.
async function settle(minNodes = 150, tries = 10, waitMs = 700) {
  let n = 0;
  for (let i = 0; i < tries; i++) {
    n =
      Number(
        await rpc("browser_eval", {
          expression: "document.readyState==='complete' ? document.getElementsByTagName('*').length : 0",
        }),
      ) || 0;
    if (n >= minNodes) return n;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return n;
}

const estTokensFromChars = (n) => Math.round(n / 4);

async function measure(url) {
  await rpc("browser_navigate", { url });
  await settle();

  // Raw-DOM size via the isolated world (CSP-immune) — no eval.
  const rawR = await timed(() => rpc("browser_dom_stats"));
  const stateR = await timed(() => rpc("browser_get_state"));
  const graphR = await timed(() => rpc("browser_get_graph", { maxNodes: 2000 }));

  const flat = flatText(stateR.value);
  const graph = graphR.value.text || "";

  return {
    url,
    domNodes: rawR.value.nodes || 0,
    interactiveNodes: (stateR.value.elements || []).length,
    graphNodes: graphR.value.count,
    raw: { chars: rawR.value.htmlChars, tokens: estTokensFromChars(rawR.value.htmlChars), ms: rawR.ms },
    flat: { chars: flat.length, tokens: estTokens(flat), ms: stateR.ms },
    graph: { chars: graph.length, tokens: estTokens(graph), ms: graphR.ms },
  };
}

function pad(v, w) {
  return String(v).padEnd(w);
}

function table(rows) {
  const head = [
    ["page", 34],
    ["domNodes", 9],
    ["raw tok", 9],
    ["flat tok", 9],
    ["graph tok", 10],
    ["raw/graph", 10],
    ["raw/flat", 9],
  ];
  const lines = [head.map(([c, w]) => pad(c, w)).join(" ")];
  lines.push("-".repeat(lines[0].length));
  for (const r of rows) {
    const short = r.url.replace(/^https?:\/\//, "").slice(0, 33);
    lines.push(
      [
        pad(short, 34),
        pad(r.domNodes, 9),
        pad(r.raw.tokens, 9),
        pad(r.flat.tokens, 9),
        pad(r.graph.tokens, 10),
        pad((r.raw.tokens / Math.max(1, r.graph.tokens)).toFixed(1) + "x", 10),
        pad((r.raw.tokens / Math.max(1, r.flat.tokens)).toFixed(1) + "x", 9),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

async function main() {
  const rows = [];
  for (const url of URLS) {
    try {
      const r = await measure(url);
      rows.push(r);
      console.error(
        `✓ ${url}  dom=${r.domNodes}  raw=${r.raw.tokens}tok  flat=${r.flat.tokens}tok  graph=${r.graph.tokens}tok  (raw/graph=${(r.raw.tokens / Math.max(1, r.graph.tokens)).toFixed(1)}x)`,
      );
    } catch (err) {
      console.error(`⚠️ ${url}: ${err instanceof Error ? err.message : err}`);
      rows.push({ url, error: String(err) });
    }
  }

  const ok = rows.filter((r) => !r.error);
  const mean = (f) => (ok.length ? Math.round(ok.reduce((s, r) => s + f(r), 0) / ok.length) : 0);
  const summary = {
    pages: ok.length,
    meanRawTokens: mean((r) => r.raw.tokens),
    meanFlatTokens: mean((r) => r.flat.tokens),
    meanGraphTokens: mean((r) => r.graph.tokens),
    meanRawOverGraph: ok.length
      ? +(ok.reduce((s, r) => s + r.raw.tokens / Math.max(1, r.graph.tokens), 0) / ok.length).toFixed(1)
      : 0,
    meanRawOverFlat: ok.length
      ? +(ok.reduce((s, r) => s + r.raw.tokens / Math.max(1, r.flat.tokens), 0) / ok.length).toFixed(1)
      : 0,
  };

  console.error("\n=== OBSERVATION SIZE (est. tokens ~ chars/4) ===\n" + table(ok));
  console.error(
    `\nmean raw=${summary.meanRawTokens}  flat=${summary.meanFlatTokens}  graph=${summary.meanGraphTokens}  |  raw/graph=${summary.meanRawOverGraph}x  raw/flat=${summary.meanRawOverFlat}x`,
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `obs-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ summary, pages: rows }, null, 2));
  console.error(`\nwritten: ${out}`);
}

main().catch((e) => {
  console.error("fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
