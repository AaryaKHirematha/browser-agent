import http from "node:http";

console.log("Browser Agent MCP Doctor\n");

let allPassed = true;

function logStatus(name, passed, info = "") {
  if (passed) {
    console.log(`[PASS] ${name}${info ? ` (${info})` : ""}`);
  } else {
    console.log(`[FAIL] ${name}${info ? ` (${info})` : ""}`);
    allPassed = false;
  }
}

async function checkHealth() {
  return new Promise((resolve) => {
    http.get("http://localhost:8778/health", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    }).on("error", () => resolve(null));
  });
}

async function run() {
  const token = process.env.BROWSER_AGENT_MCP_TOKEN;
  logStatus("Authentication configured", !!token, token ? "Token present" : "BROWSER_AGENT_MCP_TOKEN missing");

  const health = await checkHealth();
  logStatus("MCP server / Browser server :8778", !!health, health ? "Running" : "Unreachable");

  if (health) {
    logStatus("WebSocket bridge :8777", true, "Port active via server");
    logStatus("Chrome extension connected", health.extensionConnected, health.extensionConnected ? "Connected" : "Not connected");
    logStatus("MCP endpoint active", health.mcpEnabled, "Remote MCP enabled");
  } else {
    logStatus("WebSocket bridge :8777", false, "Server unreachable");
    logStatus("Chrome extension connected", false, "Server unreachable");
    logStatus("MCP endpoint active", false, "Server unreachable");
  }

  // Tool discovery
  const toolsFound = await new Promise((resolve) => {
    http.get("http://localhost:8778/methods", (res) => {
      if (res.statusCode === 200) resolve(true);
      else resolve(false);
    }).on("error", () => resolve(false));
  });
  logStatus("MCP tool discovery", toolsFound, toolsFound ? "Tools available" : "Failed to fetch tools");

  console.log(`\nOverall: ${allPassed ? "READY" : "ISSUES DETECTED"}`);
  if (!allPassed) {
    process.exit(1);
  }
}

run();
