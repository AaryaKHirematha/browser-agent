// Instrumented agent loop for benchmarking. One episode = one MiniWoB task.
//
// The OBSERVATION MODE is a flag — this is the core ablation:
//   graph : browser_get_graph  (task-conditioned semantic projection)   ← our approach
//   flat  : browser_get_state  (flat ranked list of interactive elements) ← baseline
// Both share the same index-based action interface, so representation is the
// only variable. (raw-DOM mode needs selector actions — not yet implemented.)

import { rpc } from "./lib/bridge.mjs";
import { createMessage, MODEL } from "./lib/llm.mjs";
import { startTask, episodeState } from "./lib/miniwob.mjs";

const SYSTEM = `You are solving a MiniWoB task in a live web page. You act through tools.

- Call observe() to see the page's interactive elements, each tagged [#index].
- Act on elements by index: click(index) or type(index, text).
- The task instruction is given in the first message; achieve exactly that.
- observe() again after the page changes. Indices are only valid for the most
  recent observe().
- Call done() as soon as you believe the task is complete. Be efficient.`;

const TOOLS = [
  {
    name: "observe",
    description: "See the current page as a list of interactive elements with [#index] handles.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description: "Click the element with this index (from the latest observe()).",
    input_schema: {
      type: "object",
      properties: { index: { type: "integer" } },
      required: ["index"],
    },
  },
  {
    name: "type",
    description: "Type text into the editable element with this index. Set submit to press Enter.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer" },
        text: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["index", "text"],
    },
  },
  { name: "done", description: "The task is complete.", input_schema: { type: "object", properties: {} } },
];

/** Produce the mode-specific observation string and (re)populate the action registry. */
async function observe(mode) {
  if (mode === "graph") {
    const g = await rpc("browser_get_graph", { maxNodes: 60 });
    return g.text;
  }
  // flat
  const s = await rpc("browser_get_state");
  const lines = (s.elements || []).map((e) => {
    const label = e.role || e.tag;
    const text = e.text ? ` "${e.text}"` : "";
    const edit = e.editable ? " (editable)" : "";
    return `[#${e.index}] ${label}${text}${edit}`;
  });
  return lines.length ? lines.join("\n") : "(no interactive elements)";
}

export async function runEpisode({ task, seed = 0, mode = "graph", maxSteps = 15, onEvent = () => {} }) {
  const started = Date.now();
  const { instruction } = await startTask(task, seed);
  onEvent(`▶ ${task} [${mode}] — "${instruction}"`);

  let promptTokens = 0,
    outputTokens = 0,
    observeCalls = 0,
    observeChars = 0,
    steps = 0,
    doneRequested = false;

  const messages = [
    {
      role: "user",
      content: `Task: ${instruction}\n\nStart by calling observe().`,
    },
  ];

  const finalize = (st) => ({
    task,
    seed,
    mode,
    model: MODEL,
    success: st.reward != null && st.reward > 0,
    reward: st.reward,
    done: !!st.done,
    steps,
    promptTokens,
    outputTokens,
    observeCalls,
    avgObsChars: observeCalls ? Math.round(observeChars / observeCalls) : 0,
    ms: Date.now() - started,
  });

  for (steps = 1; steps <= maxSteps; steps++) {
    const resp = await createMessage({ system: SYSTEM, tools: TOOLS, messages, max_tokens: 4000 });
    promptTokens += resp.usage?.input_tokens || 0;
    outputTokens += resp.usage?.output_tokens || 0;
    messages.push({ role: "assistant", content: resp.content });

    const toolUses = resp.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) break;

    const results = [];
    for (const tu of toolUses) {
      try {
        if (tu.name === "done") {
          doneRequested = true;
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "acknowledged" });
        } else if (tu.name === "observe") {
          const obs = await observe(mode);
          observeCalls++;
          observeChars += obs.length;
          results.push({ type: "tool_result", tool_use_id: tu.id, content: obs });
        } else if (tu.name === "click") {
          await rpc("browser_click", { index: tu.input.index });
          onEvent(`  click [#${tu.input.index}]`);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `clicked [#${tu.input.index}]` });
        } else if (tu.name === "type") {
          await rpc("browser_type", {
            index: tu.input.index,
            text: tu.input.text,
            pressEnter: tu.input.submit,
          });
          onEvent(`  type [#${tu.input.index}] ${JSON.stringify(tu.input.text)}`);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "typed" });
        } else {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `unknown tool ${tu.name}`, is_error: true });
        }
      } catch (err) {
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: err instanceof Error ? err.message : String(err),
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });

    const st = await episodeState();
    if (st.done || doneRequested) {
      const result = finalize(st.done ? st : await episodeState());
      onEvent(`  ${result.success ? "✅" : "❌"} reward=${result.reward} steps=${steps}`);
      return result;
    }
  }

  const result = finalize(await episodeState());
  onEvent(`  ${result.success ? "✅" : "❌ (budget)"} reward=${result.reward} steps=${steps}`);
  return result;
}
