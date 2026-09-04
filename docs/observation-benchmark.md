# How you feed the page to the LLM matters more than the fancy graph

*A small, honest benchmark of observation representations for browser agents.*

Every LLM browser agent has to answer one question before it can do anything:
**what do you put in the model's context to represent the page?** Raw HTML? A
screenshot? The accessibility tree? A distilled list of interactive elements?

I built a browser agent (a Chrome MV3 extension + an MCP/JSON-RPC bridge) with
a **semantic UI-graph** observation layer, expecting the graph structure to be
the win. Then I measured it. The measurements said something more useful — and
partly the opposite of what I assumed.

**TL;DR**
1. Any semantic extraction (flat list *or* graph) is **17–105× smaller than raw
   HTML** on real pages. Big, expected win.
2. The **graph is *not* smaller than a flat list** — it's ~1.1–1.5× *larger*. So
   "graph structure" is not where the token savings come from.
3. On trivial pages (MiniWoB), graph and flat are **identical** on task success
   and steps. The representation choice didn't move the needle there at all.
4. A practical trap: **strict CSP breaks `eval`-based page introspection** —
   read the DOM from the extension's isolated world instead.

> Scope: this is a *pilot*, not a paper. n = 6 pages for size, 6 MiniWoB tasks ×
> 1 seed for the agent run, one model (Claude Haiku 4.5 — see Limitations).
> Token counts are estimated as `chars / 4`; the *ratios* are what matter and
> are stable across that estimate.

---

## Setup

- **Driver.** A Chrome extension observes/acts in the real browser; a localhost
  bridge exposes it as JSON-RPC tools (`browser_get_state`, `browser_get_graph`,
  `browser_dom_stats`, `browser_click`, …).
- **Three representations of the same page:**
  - **raw** — `document.documentElement.outerHTML` (naive HTML-agent baseline).
  - **flat** — visible interactive elements as `[#i] role "text"` lines.
  - **graph** — the semantic UI-graph projection: interactive nodes + landmark
    containers as an indented tree with `[#index]` handles.
- **Size metric** — characters → est. tokens (`chars/4`), plus element counts
  and extraction latency.
- **Agent metric (MiniWoB)** — success (reward > 0), steps, tokens, latency,
  with the observation representation as the only variable.

---

## Result 1 — semantic extraction is 17–105× smaller than raw HTML

Est. tokens per page (`chars/4`):

| page | raw HTML | flat | graph | raw→graph | raw→flat |
| --- | ---: | ---: | ---: | ---: | ---: |
| en.wikipedia.org/wiki/Web_scraping | 64,156 | 3,025 | 3,761 | **17×** | 21× |
| bbc.com/news | 85,218 | 2,307 | 2,649 | **32×** | 37× |
| demoblaze.com | 10,724 | 80 | 102 | **105×** | 134× |

This is the real, robust finding, and it matches what other projects report
(e.g. accessibility-tree observations are widely cited as 10–50× smaller than
HTML). If your agent feeds raw HTML, you are burning 1–2 orders of magnitude
more tokens per step than you need to — on a 500KB page that's the difference
between a usable and an unusable context budget.

## Result 2 — the graph is not smaller than a flat list

Across every page measured, the graph ran **~1.1–1.5× larger** than the flat
list (Wikipedia 1.24×, BBC 1.15×, demoblaze 1.28×; and on three JS-heavy pages
1.08–1.51×). The tree's landmark/heading containers and indentation cost tokens
that a flat list doesn't spend.

**Implication:** the token savings come from *semantic extraction in general*,
not from the graph. If token cost is your only goal, a flat ranked list wins.
The graph has to justify itself on its *other* properties — hierarchy for
reasoning, semantic edges, and incremental deltas — none of which this
size-benchmark measures. That's the honest boundary of what's shown here.

## Result 3 — on trivial pages, representation doesn't matter

MiniWoB++ agent run (Claude Haiku 4.5, 6 tasks, seed 0):

| mode | success | avg steps | obs chars |
| --- | ---: | ---: | ---: |
| graph | 67% | 3.2 | 173 |
| flat | 67% | 3.2 | 137 |

Identical success and steps; flat again slightly smaller. The same two tasks
(`focus-text`, `click-link`) failed in **both** modes — model/grounding errors,
not representation errors. MiniWoB pages have ~5 elements, so there's nothing to
prune and no structure to exploit; the representation is irrelevant at that
scale. The graph's value proposition only exists on large, complex pages — which
means MiniWoB is the wrong stage to demonstrate it.

## Result 4 — strict CSP breaks `eval`-based introspection

First attempt read raw HTML by evaluating `document.documentElement.outerHTML`
in the page's MAIN world. It failed on GitHub, MDN, and Hacker News with:

```
EvalError: Evaluating a string as JavaScript violates the following
Content Security Policy directive ... 'unsafe-eval' is not an allowed source
```

MAIN-world `eval` is subject to the page's CSP. The fix: read `outerHTML` /
node counts from the **content script's isolated world**, which has full DOM
access, uses no `eval`, and is immune to page CSP. If you're building page
introspection for an agent, don't route DOM reads through `eval`.

---

## What I'd conclude

- **Do** feed a semantic view, not raw HTML. Non-negotiable for token budget.
- **Don't** assume a graph beats a flat list on cost — measure it; here it lost.
- The interesting open question the size-benchmark *can't* answer: do
  **incremental deltas** ("here's what changed since your last action") beat
  re-reading the page? Research suggests ~53% of steps have zero DOM change, so
  the ceiling is real — but I haven't measured whether it improves an agent yet.
  That's the experiment that would actually justify the graph.

## Limitations

- **Model.** The credential available only served Claude Haiku 4.5; Opus/Sonnet
  rate-limited. Absolute success is Haiku-level; the graph-vs-flat *comparison*
  is unaffected (same model both sides).
- **Scale.** 6 pages, 6 tasks × 1 seed. Directional, not statistically strong.
- **Tokens estimated** as `chars/4`, not a real tokenizer. Ratios are robust to
  this; absolute counts are approximate.
- **No accessibility-tree or browser-use baseline yet** — the honest next
  baseline is Playwright's `ariaSnapshot()`, which is the field standard.
- **Live-site flakiness.** StackOverflow served a bot-challenge page; live
  benchmarks (WebVoyager) inherit that noise.

## Reproduce

```bash
cd browser-agent && npm run setup
cd agent && npm start           # bridge; load the extension unpacked, open an http tab
node bench/obsbench.mjs         # observation-size table (no LLM)
node bench/run.mjs              # MiniWoB agent run (needs an API credential)
```

## Prior art

Not novel — a crowded space. See
[browser-use](https://github.com/browser-use/browser-use),
[real-browser-mcp](https://github.com/ofershap/real-browser-mcp),
Agent-Browser (Vercel), Agent-E, Notte, and the incremental-observation papers
(Region4Web, Signal-Driven Observation). The contribution here is the
measurement, not the artifact.
