import http from "node:http";
import assert from "node:assert";

let server;
let requestCount = 0;
let behavior = "ok";
let port = 0;

async function setupServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      requestCount++;
      if (req.url === "/timeout") {
        // Just hang
        return;
      }
      if (behavior === "429-with-retry-after") {
        res.writeHead(429, { "Retry-After": "1" });
        res.end(JSON.stringify({ error: "rate limited" }));
        behavior = "ok";
      } else if (behavior === "429-without-retry-after") {
        res.writeHead(429);
        res.end(JSON.stringify({ error: "rate limited" }));
        behavior = "ok";
      } else if (behavior === "repeated-429") {
        res.writeHead(429, { "Retry-After": "0.1" });
        res.end(JSON.stringify({ error: "rate limited" }));
      } else if (behavior === "503-failure") {
        res.writeHead(503);
        res.end(JSON.stringify({ error: "service unavailable" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "msg_1", content: [] }));
      }
    });
    server.listen(0, () => {
      port = server.address().port;
      resolve(port);
    });
  });
}

async function runTests() {
  await setupServer();
  const url = `http://localhost:${port}/v1/messages`;
  
  const { fetchWithRetry } = await import("../lib/llm.mjs");

  console.log("1. HTTP 429 with Retry-After (Eventual Recovery)");

  requestCount = 0;
  behavior = "429-with-retry-after";
  let t0 = Date.now();
  let res = await fetchWithRetry(url, { method: "POST" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(requestCount, 2);
  assert.ok(Date.now() - t0 >= 1000);

  console.log("2. HTTP 429 without Retry-After (Exponential backoff)");
  requestCount = 0;
  behavior = "429-without-retry-after";
  t0 = Date.now();
  res = await fetchWithRetry(url, { method: "POST" }, { maxRetries: 3, baseWaitMs: 100 });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(requestCount, 2);
  assert.ok(Date.now() - t0 >= 100);

  console.log("3. Maximum Retry Exhaustion");
  requestCount = 0;
  behavior = "repeated-429";
  try {
    await fetchWithRetry(url, { method: "POST" }, { maxRetries: 2, baseWaitMs: 10 });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.match(err.message, /Max retries reached/);
  }
  assert.strictEqual(requestCount, 3);

  console.log("4. Provider Failure (503)");
  requestCount = 0;
  behavior = "503-failure";
  try {
    await fetchWithRetry(url, { method: "POST" }, { maxRetries: 2, baseWaitMs: 10 });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.match(err.message, /Max retries reached/);
  }

  console.log("5. Timeout Handling");
  requestCount = 0;
  behavior = "ok";
  const timeoutUrl = `http://localhost:${port}/timeout`;
  try {
    await fetchWithRetry(timeoutUrl, { method: "POST" }, { maxRetries: 1, baseWaitMs: 10, timeoutMs: 100 });
    assert.fail("Should have thrown timeout");
  } catch (err) {
    assert.match(err.message, /Timeout/);
  }

  console.log("6. Cancellation during backoff");
  requestCount = 0;
  behavior = "repeated-429";
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  try {
    await fetchWithRetry(url, { method: "POST", signal: controller.signal }, { maxRetries: 10, baseWaitMs: 100 });
    assert.fail("Should have thrown abort");
  } catch (err) {
    assert.strictEqual(err.name, "AbortError");
  }

  server.close();
  console.log("All fetchWithRetry tests passed!");
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
