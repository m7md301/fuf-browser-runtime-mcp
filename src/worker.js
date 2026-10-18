'use strict';

const encoder = new TextEncoder();
const TOOL_DEFINITIONS = [
  { name: 'browser_runtime_enable', description: 'Enable browser runtime explicitly.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_runtime_status', description: 'Return complete runtime status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_runtime_disable', description: 'Disable runtime and close temporary sessions.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_request_human', description: 'Create a temporary human intervention session.', inputSchema: { type: 'object', properties: { reason: { type: 'string' }, ttlSeconds: { type: 'number' } }, required: ['reason'] } },
  { name: 'browser_human_done', description: 'Mark current human intervention complete.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_runtime_manifest', description: 'Return a portable runtime description.', inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['text', 'json'] } } } }
];
function unauthorized() { return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } }); }
function constantTimeEqual(a, b) { const aa = encoder.encode(a || ''), bb = encoder.encode(b || ''); let diff = aa.length ^ bb.length; const n = Math.max(aa.length, bb.length); for (let i = 0; i < n; i++) diff |= (aa[i % (aa.length || 1)] || 0) ^ (bb[i % (bb.length || 1)] || 0); return diff === 0; }
function authorized(request, env) { const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''); return Boolean(env.MCP_GATEWAY_SECRET) && constantTimeEqual(token, env.MCP_GATEWAY_SECRET); }
function manifest() { return { name: 'FUF Browser Runtime MCP', version: '0.1.0', endpoint: '/mcp', authentication: 'Bearer MCP_GATEWAY_SECRET', activation: 'explicit only', tools: TOOL_DEFINITIONS.map(t => t.name), security: ['MCP access is denied without the configured secret', 'HIL credentials are per-session and temporary', 'CDP and VNC are not exposed directly'] }; }
function rpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function toolText(value) { return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }; }

export class RuntimeRelay {
  constructor(state, env) { this.state = state; this.env = env; this.socket = null; this.pending = new Map(); }
  async fetch(request) {
    if (!constantTimeEqual((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), this.env.MCP_GATEWAY_SECRET || '')) return unauthorized();
    const url = new URL(request.url);
    if (url.pathname === '/relay/connect' && request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair(); const client = pair[0], server = pair[1]; server.accept(); this.socket = server;
      server.addEventListener('message', event => { try { const msg = JSON.parse(event.data); const p = this.pending.get(msg.id); if (p) { this.pending.delete(msg.id); p(msg); } } catch {} });
      server.addEventListener('close', () => { if (this.socket === server) this.socket = null; for (const p of this.pending.values()) p({ status: 502, body: JSON.stringify({ error: 'connector_disconnected' }) }); this.pending.clear(); });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === '/relay/action' && request.method === 'POST') {
      if (!this.socket || this.socket.readyState !== 1) return Response.json({ status: 'relay_not_connected' }, { status: 503 });
      const payload = await request.json(); const id = crypto.randomUUID();
      const answer = new Promise(resolve => { this.pending.set(id, resolve); setTimeout(() => { if (this.pending.delete(id)) resolve({ status: 504, body: JSON.stringify({ error: 'connector_timeout' }) }); }, 25000); });
      this.socket.send(JSON.stringify({ type: 'action', id, action: payload.action, arguments: payload.arguments || {} }));
      const result = await answer; return new Response(result.body || JSON.stringify(result), { status: result.status || 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('Not Found', { status: 404 });
  }
}

export default { async fetch(request, env) {
  if (!authorized(request, env)) return unauthorized();
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ok: true, service: 'fuf-browser-runtime-mcp' });
  if (url.pathname !== '/mcp') return new Response('Not Found', { status: 404 });
  if (request.method === 'GET') return Response.json(manifest());
  let message; try { message = await request.json(); } catch { return Response.json(rpcError(null, -32700, 'Invalid JSON'), { status: 400 }); }
  const id = message.id ?? null;
  if (message.method === 'initialize') return Response.json(rpc(id, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fuf-browser-runtime-mcp', version: '0.1.0' } }));
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return new Response(null, { status: 202 });
  if (message.method === 'ping') return Response.json(rpc(id, {}));
  if (message.method === 'tools/list') return Response.json(rpc(id, { tools: TOOL_DEFINITIONS }));
  if (message.method !== 'tools/call') return Response.json(rpcError(id, -32601, 'Method not found'));
  const name = message.params?.name, args = message.params?.arguments || {};
  if (!TOOL_DEFINITIONS.some(tool => tool.name === name)) return Response.json(rpcError(id, -32602, `Unknown tool: ${name}`));
  if (name === 'browser_runtime_manifest') return Response.json(rpc(id, toolText(manifest())));
  const relay = env.RUNTIME_RELAY;
  if (!relay) return Response.json(rpc(id, toolText({ ok: false, status: 'relay_not_configured' })));
  const stub = relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || 'runtime'));
  const response = await stub.fetch('https://relay.internal/relay/action', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.MCP_GATEWAY_SECRET}` }, body: JSON.stringify({ action: name, arguments: args }) });
  return Response.json(rpc(id, toolText({ status: response.status, body: await response.text() })));
} };
