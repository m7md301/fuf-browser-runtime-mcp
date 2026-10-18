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
  const relay = env.RUNTIME_RELAY_URL;
  if (!relay) return Response.json(rpc(id, toolText({ ok: false, status: 'relay_not_configured', action: name, message: 'The MCP gateway is deployed, but the private runtime relay is not configured yet.' })));
  try {
    const response = await fetch(`${relay.replace(/\/$/, '')}/mcp/action`, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.MCP_GATEWAY_SECRET}` }, body: JSON.stringify({ action: name, arguments: args }) });
    return Response.json(rpc(id, toolText({ status: response.status, body: await response.text() })));
  } catch (error) { return Response.json(rpc(id, toolText({ ok: false, status: 'relay_error', error: error.message })));
  }
} };
