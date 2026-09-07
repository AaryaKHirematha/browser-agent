import http from "node:http";
import assert from "node:assert";

// Accelerate time
process.env.OPENAI_MODEL = "test-model";
process.env.LLM_BASE_WAIT_MS = "1"; // 1ms for ultra-fast simulation

let server;
let callCount = 0;
let port = 0;

const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  retries: 0,
  exhaustedRetries: 0,
  count429: 0,
  count503: 0,
  timeoutCount: 0,
  cancellationCount: 0,
  duplicateActionCount: 0,
  stateCorruptionCount: 0,
  maxRetryDelay: 0
};

// 60 cycles to represent 60 minutes of autonomous work
const numCycles = 60;
const sequence = [];

// Generate a deterministic sequence with bursts of 429 and intermittent 503
for (let i = 0; i < numCycles; i++) {
  sequence.push("ok");
  sequence.push("tool");
  
  if (i % 5 === 0) {
    // intermittent 503
    sequence.push("503");
    sequence.push("503");
    sequence.push("ok");
  } else if (i % 7 === 0) {
    // burst of 429
    sequence.push("429");
    sequence.push("429");
    sequence.push("429");
    sequence.push("ok");
  } else if (i % 11 === 0) {
    // timeout simulation (actually just 503 for now, timeout takes 60s without config)
    sequence.push("503");
    sequence.push("ok");
  } else if (i === numCycles - 1) {
    // fatal failure at the end
    for(let j=0; j<10; j++) sequence.push("503");
  } else {
    sequence.push("ok");
  }
}

async function setupServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      stats.totalRequests++;
      const action = sequence[Math.min(callCount, sequence.length - 1)];
      callCount++;

      if (action === "ok" || action === "tool") {
        stats.successfulRequests++;
        res.writeHead(200, { "Content-Type": "application/json" });
        if (action === "tool") {
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: "",
                tool_calls: [{ id: "t_1", type: "function", function: { name: "click", arguments: "{}" } }]
              }
            }]
          }));
        } else {
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: "Success message",
                tool_calls: []
              }
            }]
          }));
        }
      } else if (action === "429") {
        stats.count429++;
        stats.retries++;
        res.writeHead(429, { "Retry-After": "0.01" });
        res.end(JSON.stringify({ error: { message: "rate limited" } }));
      } else if (action === "503") {
        stats.count503++;
        stats.retries++;
        res.writeHead(503);
        res.end(JSON.stringify({ error: { message: "service unavailable" } }));
      }
    });
    server.listen(0, () => {
      port = server.address().port;
      resolve(port);
    });
  });
}

async function runSoakTest() {
  await setupServer();
  process.env.OPENAI_API_BASE = `http://localhost:${port}/v1`;
  const { createMessage } = await import("../lib/llm.mjs");

  console.log("Starting Long-Run Soak Simulation...");
  
  let agentState = { step: 0, toolsExecuted: new Set() };
  let fatalErrors = 0;

  for (let i = 0; i < sequence.length; i++) {
    // If the sequence expects a fatal failure, catch it
    const action = sequence[i];
    
    // Check if we are in a fatal loop (10 503s)
    let isFatal = false;
    if (i + 6 < sequence.length) {
      isFatal = sequence.slice(i, i+7).every(a => a === "503");
    }

    try {
      const resp = await createMessage({
        system: "soak-test",
        tools: [],
        messages: [{ role: "user", content: "step " + agentState.step }]
      });
      
      agentState.step++;
      
      if (resp.content && resp.content.some(c => c.type === "tool_use")) {
        const tool = resp.content.find(c => c.type === "tool_use");
        if (agentState.toolsExecuted.has(tool.id + "_" + agentState.step)) {
          stats.duplicateActionCount++;
        }
        agentState.toolsExecuted.add(tool.id + "_" + agentState.step);
      }
      
      // Fast forward callCount to match where we should be if retries succeeded
      while(i < sequence.length - 1 && (sequence[i] === "429" || sequence[i] === "503")) {
        i++;
      }

    } catch (e) {
      if (e.message.includes("Max retries reached")) {
        stats.exhaustedRetries++;
        fatalErrors++;
        // Fast forward past the fatal burst
        while(i < sequence.length && sequence[i] === "503") i++;
      } else {
        console.error("Unexpected error:", e);
        stats.stateCorruptionCount++;
      }
    }
  }

  server.close();
  
  console.log("=== Long-Run Simulation Statistics ===");
  console.log("Total requests:", stats.totalRequests);
  console.log("Successful requests:", stats.successfulRequests);
  console.log("Retries triggered:", stats.retries);
  console.log("Exhausted retries:", stats.exhaustedRetries);
  console.log("429 Rate Limits:", stats.count429);
  console.log("503 Errors:", stats.count503);
  console.log("Duplicate Actions:", stats.duplicateActionCount);
  console.log("State Corruptions:", stats.stateCorruptionCount);
  console.log("Fatal Errors handled:", fatalErrors);
  
  assert.strictEqual(stats.duplicateActionCount, 0, "Duplicate actions occurred!");
  assert.strictEqual(stats.stateCorruptionCount, 0, "State corruption occurred!");
  assert.ok(stats.totalRequests >= numCycles * 2);
  assert.ok(stats.successfulRequests > 0);
  assert.ok(fatalErrors > 0, "Simulation did not trigger expected permanent failure limit");
  
  console.log("Soak test passed successfully!");
}

runSoakTest().catch(err => {
  console.error(err);
  process.exit(1);
});
