import { performance } from 'perf_hooks';

const RPC_URL = 'http://localhost:8778/rpc';
const CONCURRENCY_LEVELS = [1, 5, 10, 25, 50];
const ITERATIONS_PER_USER = 10;

async function rpcCall(method, params, id = 1) {
  const req = { jsonrpc: '2.0', id, method, params };
  const start = performance.now();
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    const data = await res.json();
    return { success: !data.error, time: performance.now() - start, data };
  } catch (e) {
    return { success: false, time: performance.now() - start, error: e.message };
  }
}

async function runWorker(userId, iterations) {
  let successCount = 0;
  let latencies = [];
  
  for (let i = 0; i < iterations; i++) {
    // We will test memory/task isolation by creating a task per user
    const res = await rpcCall('browser_create_task', { goal: `Task for user ${userId} iteration ${i}` }, userId);
    latencies.push(res.time);
    if (res.success) successCount++;
  }
  
  return { successCount, latencies };
}

async function runLoadTest() {
  console.log('--- LOAD & STRESS TESTING HARNESS ---');
  for (const concurrency of CONCURRENCY_LEVELS) {
    console.log(`\nTesting Concurrency: ${concurrency} users`);
    const workers = [];
    const startTime = performance.now();
    
    for (let i = 0; i < concurrency; i++) {
      workers.push(runWorker(i, ITERATIONS_PER_USER));
    }
    
    const results = await Promise.all(workers);
    const totalTime = performance.now() - startTime;
    
    let totalSuccess = 0;
    let allLatencies = [];
    results.forEach(r => {
      totalSuccess += r.successCount;
      allLatencies.push(...r.latencies);
    });
    
    const totalRequests = concurrency * ITERATIONS_PER_USER;
    const rps = (totalRequests / (totalTime / 1000)).toFixed(2);
    
    allLatencies.sort((a, b) => a - b);
    const avg = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
    const p50 = allLatencies[Math.floor(allLatencies.length * 0.5)];
    const p95 = allLatencies[Math.floor(allLatencies.length * 0.95)];
    const p99 = allLatencies[Math.floor(allLatencies.length * 0.99)];
    
    console.log(`Requests: ${totalSuccess}/${totalRequests} successful`);
    console.log(`Throughput: ${rps} req/sec`);
    console.log(`Latencies: Avg=${avg.toFixed(2)}ms, p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`);
    
    if (totalSuccess < totalRequests) {
      console.log(`Warning: System struggled at concurrency ${concurrency}. Max stable concurrency reached.`);
      break;
    }
  }
}

runLoadTest().catch(console.error);
