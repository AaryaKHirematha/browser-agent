// JSON-RPC client for the browser-agent bridge (the same HTTP surface any
// external client uses).
const RPC_URL = process.env.RPC_URL || "http://localhost:8778/rpc";
let id = 1;

export async function rpc(method, params = {}) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result;
}
