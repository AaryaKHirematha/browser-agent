# Remote MCP Integration

The Browser Agent exposes a standards-based remote MCP interface designed for interoperability with MCP-compatible AI agents. 

This enables remote AI agents (such as Claude Web, Gemini, ChatGPT custom MCP clients, or other MCP-compatible clients) to securely drive your local browser using the same Trustworthy Autonomous Browser Agent safety layers.

## 📡 Remote MCP Endpoint

The agent supports the standard **MCP over HTTP (SSE)** transport.

- **Endpoint**: `http://localhost:8778/mcp`
- **Transport**: Server-Sent Events (SSE)

### Authentication

A remote MCP endpoint MUST NOT expose unrestricted browser control to the public internet. The Browser Agent enforces bearer token authentication.

Set the token in your environment before starting the agent:
```bash
export BROWSER_AGENT_MCP_TOKEN="your-secure-token-here"
```

Clients must send this token using the HTTP `Authorization` header:
```
Authorization: Bearer your-secure-token-here
```
*(For clients that do not support setting custom headers, the token can also be passed via the `?token=` query parameter, though headers are strongly preferred.)*

### Local Development Mode

If you are developing locally and want to allow unauthenticated localhost access, set:
```bash
export BROWSER_AGENT_ALLOW_UNAUTHENTICATED_LOCALHOST="true"
```
**Warning**: Only enable this if you fully trust local processes on your machine.

## 🔒 Security & Safety Layers

Remote MCP does **not** bypass the existing security layers. A remote client calling `browser_click` must eventually pass through the same safety pipeline used locally. 

The pipeline ensures:
1. **Risk Assessment**: The action is classified by the Risk Engine.
2. **Policy Checks**: Allowed and blocked domains are enforced. High-risk actions on untrusted domains will pause the task and require explicit Human Approval.
3. **Security Scans**: Prompt-injection and suspicious instructions are blocked before execution.
4. **Privacy Redaction**: Sensitive data (e.g., SSNs, Passwords) are redacted from the DOM before being sent back to the remote AI.
5. **Audit Logging**: Every action, approval, and verification is recorded in the session-scoped memory.

### Session Management

The Remote MCP endpoint supports **Session Isolation**. Each SSE connection maintains its own Task Context. 
However, there is a known limitation: the underlying Chrome Extension operates in a single browser tab context. Multiple AI agents executing simultaneously will compete for the same physical browser tab. **It is highly recommended to run only one active session at a time.**

## 🌐 Secure Remote Deployment (HTTPS)

To expose your local browser to a cloud-based AI agent (like Claude Web or Gemini), you MUST NOT expose the raw HTTP endpoint directly to the internet.

Use a secure HTTPS reverse proxy or authenticated tunnel:
```
AI Client  →  HTTPS  →  Secure Tunnel (e.g. ngrok, Cloudflare Tunnel)  →  Browser Agent (localhost:8778)  →  Chrome
```

Example using Cloudflare Tunnel:
```bash
cloudflared tunnel --url http://localhost:8778
```
*Be sure to enforce `BROWSER_AGENT_MCP_TOKEN` so only you can access the tunnel.*

## 📋 Compatibility

- **Claude Desktop / Claude Web**: Target (Requires SSE Transport)
- **Cursor**: Target (Requires SSE Transport or bridging)
- **Gemini**: Target
- **ChatGPT**: Target

*Note: Integration with specific platforms is marked "Implementation-ready / not externally verified" until end-to-end cloud platform tests are performed.*
