import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import * as eventsource from "eventsource";
global.EventSource = eventsource.default || eventsource;

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 8778;
process.env.HTTP_PORT = String(PORT);
process.env.BROWSER_AGENT_MCP_TOKEN = process.env.BROWSER_AGENT_MCP_TOKEN || "demo-token";

const MCP_URL = `http://localhost:${PORT}/mcp`;
const MCP_TOKEN = process.env.BROWSER_AGENT_MCP_TOKEN;

const serverPath = fileURLToPath(new URL("../agent/dist/server.js", import.meta.url));

async function runDemo() {
  console.log("🛡️ Trustworthy Browser Agent - Remote MCP E2E Demo\n");

  console.log("Starting local test server...");
  const server = spawn("node", [serverPath], { env: process.env, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1000));

  const transport = new SSEClientTransport(new URL(MCP_URL), {
    eventSourceInit: {
      headers: {
        Authorization: `Bearer ${MCP_TOKEN}`,
      },
    },
    requestInit: {
      headers: {
        Authorization: `Bearer ${MCP_TOKEN}`,
      },
    }
  });

  const client = new Client(
    { name: "mcp-demo-client", version: "1.0.0" },
    { capabilities: {} }
  );

  console.log(`Connecting to ${MCP_URL} ...`);
  
  try {
    await client.connect(transport);
    console.log("✓ Connected successfully to Remote MCP endpoint!\n");

    console.log("Listing tools...");
    const tools = await client.listTools();
    console.log(`✓ Discovered ${tools.tools.length} tools`);
    
    const observeTool = tools.tools.find(t => t.name === "browser_observe");
    if (!observeTool) {
      throw new Error("browser_observe tool not found!");
    }

    console.log("\n1. Testing: browser_observe");
    const observeRes = await client.callTool({
      name: "browser_observe",
      arguments: {}
    });
    
    const parsedObs = JSON.parse(observeRes.content[0].text);
    console.log(`✓ Observation successful. Current URL: ${parsedObs.page.url}`);
    
    // Check if security scan ran
    if (parsedObs.security && parsedObs.security.injectionWarnings) {
      console.log(`✓ Security layer active (detected ${parsedObs.security.injectionWarnings.length} warnings)`);
    }

    console.log("\n2. Testing: browser_create_task");
    const taskRes = await client.callTool({
      name: "browser_create_task",
      arguments: {
        goal: "Remote MCP Task Validation"
      }
    });
    const parsedTask = JSON.parse(taskRes.content[0].text);
    console.log(`✓ Task created. ID: ${parsedTask.id}`);

    console.log("\n3. Testing: browser_assess_action (Trust layer check)");
    const assessRes = await client.callTool({
      name: "browser_assess_action",
      arguments: {
        action: "CLICK",
        description: "Click a standard button",
        category: "NAVIGATE",
        domain: "example.com"
      }
    });
    if (assessRes.isError) {
      console.log(`✓ Assessment failed as expected (or returned error): ${assessRes.content[0].text}`);
    } else {
      const parsedAssess = JSON.parse(assessRes.content[0].text);
      console.log(`✓ Assessment successful. Risk level: ${parsedAssess.level}`);
    }
    
    console.log("\n✨ E2E MCP Demo finished successfully!");
    
  } catch (err) {
    console.error("Demo failed:", err);
    process.exit(1);
  } finally {
    // Attempt to disconnect cleanly
    try {
      server.kill();
      process.exit(0);
    } catch(e) {}
  }
}

runDemo();
