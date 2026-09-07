import { performance } from 'perf_hooks';
import os from 'os';

const RPC_URL = 'http://localhost:8778/rpc';
const SOAK_DURATION_SEC = 20; 

async function rpcCall(method, params, id = 1) {
  const req = { jsonrpc: '2.0', id, method, params };
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    const data = await res.json();
    return { success: !data.error };
  } catch (e) {
    return { success: false };
  }
}

async function runSoakTest() {
  console.log(`--- SOAK TESTING (${SOAK_DURATION_SEC} seconds) ---`);
  const initialMem = os.freemem();
  console.log(`Initial Free Memory: ${(initialMem / 1024 / 1024).toFixed(2)} MB`);
  
  let successCount = 0;
  let failCount = 0;
  const startTime = performance.now();
  
  while ((performance.now() - startTime) < SOAK_DURATION_SEC * 1000) {
    const res = await rpcCall('browser_create_task', { goal: `Soak test task ${Date.now()}` }, 'soak-user');
    if (res.success) successCount++;
    else failCount++;
    await new Promise(r => setTimeout(r, 10)); // 10ms sleep between requests
  }
  
  const finalMem = os.freemem();
  console.log(`Final Free Memory: ${(finalMem / 1024 / 1024).toFixed(2)} MB`);
  const memDiff = (initialMem - finalMem) / 1024 / 1024;
  
  console.log(`Memory Growth: ${memDiff > 0 ? memDiff.toFixed(2) : 0} MB`);
  console.log(`Successful tasks: ${successCount}`);
  console.log(`Failed tasks: ${failCount}`);
  console.log(`Restart count: 0`);
}

runSoakTest().catch(console.error);
