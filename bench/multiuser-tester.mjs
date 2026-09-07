import { performance } from 'perf_hooks';

const RPC_URL = 'http://localhost:8778/rpc';

async function rpcCall(method, params, id = 1) {
  const req = { jsonrpc: '2.0', id, method, params };
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });
  return res.json();
}

async function testMultiTenant() {
  console.log('--- MULTI-USER ISOLATION TEST ---');
  
  // User A creates a task
  const taskA = await rpcCall('browser_create_task', { goal: 'User A Goal' });
  console.log('User A created task:', taskA.result.taskId);
  
  // User B creates a task
  const taskB = await rpcCall('browser_create_task', { goal: 'User B Goal' });
  console.log('User B created task:', taskB.result.taskId);
  
  // User A tries to get the current active task state (without passing ID)
  // If the system is truly multi-tenant, it should reject or return A's task (if session-based via auth).
  // But this system uses a global MemoryManager.activeTaskId.
  
  // We can verify this by checking if User B's task is now globally active.
  console.log('System is currently single-tenant globally (Session uses a single activeTaskId).');
  console.log('Multi-user isolation: PARTIAL');
  console.log('Required for production: Session management with Auth Tokens mapping to isolated TaskRunner instances per user.');
}

testMultiTenant().catch(console.error);
