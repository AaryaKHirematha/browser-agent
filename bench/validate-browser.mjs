import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../extension');
const AGENT_SERVER_SCRIPT = path.join(__dirname, '../agent/dist/server.js');
const DEMO_SERVER_SCRIPT = path.join(__dirname, '../demo/server.js');

let browserContext;
let agentProcess;
let demoProcess;

// Utility for RPC
async function rpcCall(method, params = {}) {
  const res = await fetch('http://localhost:8778/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startServers() {
  console.log('[Setup] Starting Demo Server...');
  demoProcess = spawn('node', [DEMO_SERVER_SCRIPT], { stdio: 'pipe' });
  
  console.log('[Setup] Starting Agent Server...');
  agentProcess = spawn('node', [AGENT_SERVER_SCRIPT], { stdio: 'pipe' });
  
  // Wait a bit for them to listen
  await sleep(2000);
}

function stopServers() {
  console.log('[Cleanup] Stopping servers...');
  if (agentProcess) agentProcess.kill();
  if (demoProcess) demoProcess.kill();
}

const metrics = {
  observationLatencies: [],
  actionLatencies: [],
  verificationLatencies: [],
  taskDurations: [],
  observationCount: 0,
  actionCount: 0,
  retries: 0,
  payloadSizes: []
};

async function measure(name, type, fn) {
  const start = Date.now();
  const res = await fn();
  const dur = Date.now() - start;
  
  if (type === 'observe') metrics.observationLatencies.push(dur);
  else if (type === 'action') metrics.actionLatencies.push(dur);
  else if (type === 'verify') metrics.verificationLatencies.push(dur);
  
  console.log(`  -> [${name}] completed in ${dur}ms`);
  return res;
}

async function runValidation() {
  try {
    await startServers();

    console.log('[Setup] Launching Chrome with unpacked extension...');
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    const page = browserContext.pages()[0] || await browserContext.newPage();
    
    // Wait for bridge to connect
    console.log('Waiting for extension to connect to bridge...');
    let connected = false;
    for (let i=0; i<10; i++) {
      try {
        const health = await fetch('http://localhost:8778/health').then(r => r.json());
        if (health.extensionConnected) { connected = true; break; }
      } catch(e) {}
      await sleep(1000);
    }
    
    if (!connected) throw new Error('Extension failed to connect to Bridge.');
    console.log('[Setup] Extension connected. Running Phases...');

    // ── PHASE 4 & 5: Real Autonomous Task & Observation
    console.log('\\n=== PHASE 4 & 5: Real Observation & Action ===');
    const t0 = Date.now();
    await page.goto('http://localhost:3000/index.html');
    await sleep(1000);

    const task = await rpcCall('browser_create_task', { goal: 'Search for quantum computer and verify result', startUrl: 'http://localhost:3000/index.html' });
    console.log(`Task Created: ${task.id}`);

    // Observe
    let obs = await measure('Observation', 'observe', () => rpcCall('browser_observe', { task: 'Find search box' }));
    metrics.observationCount++;
    metrics.payloadSizes.push(JSON.stringify(obs).length);
    console.log(`  Observed ${obs.interactiveCount} elements.`);

    // Find the input element index
    const inputNode = obs.elements.find(n => n.role === 'textbox' || n.text.toLowerCase().includes('search'));
    if (!inputNode) throw new Error('Could not find search input in observation');

    // Action: Type
    await measure('Action: Type', 'action', () => rpcCall('browser_type', { index: inputNode.index, text: 'Quantum' }));
    metrics.actionCount++;

    // Action: Click Search Button
    const searchBtn = obs.elements.find(n => n.role === 'button' && n.text.toLowerCase().includes('search'));
    if (!searchBtn) throw new Error('Could not find search button');
    
    await measure('Action: Click', 'action', () => rpcCall('browser_click', { index: searchBtn.index }));
    metrics.actionCount++;
    
    // Verify
    const verifyRes = await measure('Verification', 'verify', () => rpcCall('browser_verify_action', { 
      actionDescription: 'Click search button',
      expectedCondition: 'Results containing Quantum are shown'
    }));
    console.log(`  Verification: ${verifyRes.status} (${verifyRes.summary})`);
    metrics.taskDurations.push(Date.now() - t0);

    // ── PHASE 6: Dynamic DOM Recovery
    console.log('\\n=== PHASE 6: Dynamic DOM Recovery ===');
    await page.goto('http://localhost:3000/dynamic.html');
    await sleep(500); // Load initial

    // Observe button
    obs = await measure('Observe Dynamic Page', 'observe', () => rpcCall('browser_observe', { task: 'Find button' }));
    const staleBtn = obs.elements.find(n => n.text.includes('Click Me'));
    
    // Trigger DOM change, detaching the button
    await page.evaluate(() => window.makeStale());
    await sleep(500);
    
    try {
      // Attempting to click the old index should fail or trigger recovery (TaskRunner does this, but we are simulating the low level)
      // Since we are calling low-level RPC, it will fail, which is exactly what we want, then we reassess.
      await rpcCall('browser_click', { index: staleBtn.index });
      console.error('  WARNING: Click succeeded on stale element unexpectedly (or no error thrown).');
    } catch(e) {
      console.log('  Action failed due to stale element. Triggering recovery...');
      metrics.retries++;
      // Re-observe and semantically match
      obs = await measure('Recovery Observation', 'observe', () => rpcCall('browser_observe', { task: 'Find button again' }));
      const newBtn = obs.elements.find(n => n.text.includes('Click Me'));
      await rpcCall('browser_click', { index: newBtn.index });
      console.log('  Recovery Click Successful.');
    }

    // ── PHASE 7: Prompt Injection
    console.log('\\n=== PHASE 7: Prompt Injection Defense ===');
    await page.goto('http://localhost:3000/prompt-injection.html');
    await sleep(1000);
    obs = await rpcCall('browser_observe', { task: 'Read comments', mode: 'GRAPH' });
    console.log(`  Security Warnings:`, obs.security?.injectionWarnings || 'None');
    if (!obs.security?.injectionWarnings?.length) {
       console.log('Observation output:', JSON.stringify(obs, null, 2));
       throw new Error('Prompt injection not detected');
    }

    // ── PHASE 8: Privacy
    console.log('\\n=== PHASE 8: Privacy Redaction ===');
    await page.goto('http://localhost:3000/sensitive.html');
    await sleep(1000);
    obs = await rpcCall('browser_observe', { task: 'Read profile' });
    console.log(`  Redactions:`, obs.redaction);
    const obsStr = JSON.stringify(obs);
    if (obsStr.includes('john.doe') || obsStr.includes('4532-8901')) {
       throw new Error('Sensitive data leaked in observation!');
    }
    console.log('  Privacy validation passed. Data redacted.');

    // ── PHASE 9: Human Approval
    console.log('\\n=== PHASE 9: Human Approval Gateway ===');
    await page.goto('http://localhost:3000/high-risk.html');
    await sleep(1000);
    obs = await rpcCall('browser_observe', { task: 'Find delete button' });
    const delBtn = obs.elements.find(n => n.text.toLowerCase().includes('delete'));
    
    const risk = await rpcCall('browser_assess_action', {
      action: 'CLICK', description: 'Click permanently delete', category: 'DELETE', domain: 'localhost'
    });
    console.log(`  Risk Level: ${risk.level}`);
    if (risk.level === 'CRITICAL' || risk.level === 'HIGH') {
      const approval = await rpcCall('browser_request_approval', {
        action: 'CLICK', target: 'Delete Workspace', domain: 'localhost', riskLevel: risk.level, reason: risk.reason
      });
      console.log(`  Approval requested: ${approval.id}`);
      
      const resolved = await rpcCall('browser_resolve_approval', {
        requestId: approval.id, decision: 'APPROVED'
      });
      console.log(`  Approval resolved: ${resolved.status}`);
      await rpcCall('browser_click', { index: delBtn.index });
    }

    // ── PHASE 10: Verification Failure
    console.log('\\n=== PHASE 10: Verification Failure ===');
    await page.goto('http://localhost:3000/verification.html');
    await sleep(1000);
    obs = await rpcCall('browser_observe', { task: 'Find submit' });
    const subBtn = obs.elements.find(n => n.text.toLowerCase().includes('submit'));
    await rpcCall('browser_click', { index: subBtn.index }); // Returns OK but fails in DOM
    const vFail = await measure('Verification (Expected Fail)', 'verify', () => rpcCall('browser_verify_action', { 
      actionDescription: 'Click submit button',
      expectedCondition: 'Confirmation message appears'
    }));
    console.log(`  Verification result: ${vFail.status} (${vFail.summary})`);
    if (vFail.status === 'VERIFIED_SUCCESS') throw new Error('False success reported on verification!');

    // Print metrics
    console.log('\\n=== BENCHMARK METRICS ===');
    const avg = arr => arr.reduce((a,b)=>a+b, 0) / (arr.length || 1);
    console.log(`Observation Latency: min=${Math.min(...metrics.observationLatencies)}ms, avg=${Math.round(avg(metrics.observationLatencies))}ms, max=${Math.max(...metrics.observationLatencies)}ms`);
    console.log(`Action Latency: min=${Math.min(...metrics.actionLatencies)}ms, avg=${Math.round(avg(metrics.actionLatencies))}ms, max=${Math.max(...metrics.actionLatencies)}ms`);
    console.log(`Verification Latency: min=${Math.min(...metrics.verificationLatencies)}ms, avg=${Math.round(avg(metrics.verificationLatencies))}ms, max=${Math.max(...metrics.verificationLatencies)}ms`);
    console.log(`Total Observations: ${metrics.observationCount}`);
    console.log(`Total Actions: ${metrics.actionCount}`);
    console.log(`Payload Sizes: min=${Math.min(...metrics.payloadSizes)} bytes, max=${Math.max(...metrics.payloadSizes)} bytes`);

    console.log('\\nAll integration validations passed!');
  } catch (err) {
    console.error('Validation failed:', err);
    process.exitCode = 1;
  } finally {
    if (browserContext) await browserContext.close();
    stopServers();
  }
}

runValidation();
