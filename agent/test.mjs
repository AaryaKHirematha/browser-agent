// End-to-end smoke test: exercises the full chain (JSON-RPC → server → bridge →
// extension → page) against whatever tab is focused. Server must be running and
// the extension connected.
//
//   node test.mjs                 # runs against the active tab, read-only-ish
//   node test.mjs https://example.com   # navigates there first
//
// It calls each tool once and reports pass/fail. The only "mutating" calls are
// highlight (drawn then cleared) and an optional navigate.

const RPC = process.env.RPC_URL ?? "http://localhost:8778/rpc";
const navTarget = process.argv[2];

let id = 1;
async function rpc(method, params = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

async function step(label, fn) {
  try {
    const r = await fn();
    pass(label);
    return r;
  } catch (e) {
    fail(`${label} — ${e.message}`);
    throw e;
  }
}

async function main() {
  console.log("browser-agent smoke test →", RPC);

  const health = await fetch(RPC.replace("/rpc", "/health")).then((r) => r.json());
  if (!health.extensionConnected) {
    fail("extension not connected — reload the extension card and a web page");
    process.exit(1);
  }
  pass("extension connected");

  if (navTarget) {
    await step(`navigate → ${navTarget}`, () => rpc("browser_navigate", { url: navTarget }));
  }

  const state = await step("browser_get_state", () => rpc("browser_get_state"));
  console.log(`      ${state.url}`);
  console.log(`      ${state.elements.length} interactive elements`);

  const editable = state.elements.filter((e) => e.editable);
  console.log(`      ${editable.length} editable, ${state.elements.filter((e) => e.inViewport).length} in viewport`);

  await step("browser_highlight", () => rpc("browser_highlight"));
  await step("browser_scroll (down)", () => rpc("browser_scroll", { direction: "down" }));
  await step("browser_scroll (top)", () => rpc("browser_scroll", { direction: "top" }));

  if (state.elements[0]) {
    await step("browser_scroll_to (index 0)", () => rpc("browser_scroll_to", { index: 0 }));
  }

  await step("browser_clear_highlight", () => rpc("browser_clear_highlight"));

  console.log("\n\x1b[32mall good\x1b[0m — the full agent→browser chain works.");
}

main().catch(() => process.exit(1));
