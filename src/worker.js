'use strict';

const encoder = new TextEncoder();
function unauthorized() { return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } }); }
function constantTimeEqual(a, b) { const aa = encoder.encode(a || ''), bb = encoder.encode(b || ''); let diff = aa.length ^ bb.length; const n = Math.max(aa.length, bb.length); for (let i = 0; i < n; i++) diff |= (aa[i % (aa.length || 1)] || 0) ^ (bb[i % (bb.length || 1)] || 0); return diff === 0; }
function authorized(request, env) { const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''); return Boolean(env.MCP_GATEWAY_SECRET) && constantTimeEqual(token, env.MCP_GATEWAY_SECRET); }
function manifest() { return { name: 'FUF Browser Runtime MCP', version: '0.1.0', endpoint: '/mcp', authentication: 'Bearer MCP_GATEWAY_SECRET', activation: 'explicit only', tools: ['browser_runtime_enable','browser_runtime_status','browser_runtime_disable','browser_request_human','browser_human_done','browser_runtime_manifest'], security: ['MCP access is denied without the configured secret','HIL credentials are per-session and temporary','CDP and VNC are not exposed directly'] }; }
function result(id, value) { return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] } }; }
function failure(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
export default { async fetch(request, env) {
  if (!authorized(request, env)) return unauthorized();
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ok: true, service: 'fuf-browser-runtime-mcp' });
  if (url.pathname !== '/mcp') return new Response('Not Found', { status: 404 });
  if (request.method === 'GET') return Response.json(manifest());
  let message; try { message = await request.json(); } catch { return Response.json(failure(null, -32700, 'Invalid JSON'), { status: 400 }); }
  const id = message.id ?? null;
  if (message.method === 'initialize') return Response.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fuf-browser-runtime-mcp', version: '0.1.0' } } });
  if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (message.method === 'tools/list') return Response.json(result(id, { tools: [
    { name: 'browser_runtime_enable', description: 'Enable browser runtime explicitly.', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_runtime_status', description: 'Return complete runtime status.', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_runtime_disable', description: 'Disable runtime and close temporary sessions.', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_request_human', description: 'Create a temporary human intervention session.', inputSchema: { type: 'object', properties: { reason: { type: 'string' }, ttlSeconds: { type: 'number' } }, required: ['reason'] } },
    { name: 'browser_human_done', description: 'Mark current human intervention complete.', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_runtime_manifest', description: 'Return a portable runtime description.', inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['text','json'] } } } }
  ]}));
  if (message.method !== 'tools/call') return Response.json(failure(id, -32601, 'Method not found'));
  const name = message.params?.name, args = message.params?.arguments || {};
  if (name === 'browser_runtime_manifest') return Response.json(result(id, manifest()));
  const relay = env.RUNTIME_RELAY_URL;
  if (!relay) return Response.json(result(id, { ok: false, status: 'relay_not_configured', action: name, message: 'The MCP gateway is deployed, but the private runtime relay is not configured yet.' }));
  const response = await fetch(`${relay.replace(/\/$/, '')}/mcp/action`, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.MCP_GATEWAY_SECRET}` }, body: JSON.stringify({ action: name, arguments: args }) });
  return Response.json(result(id, { status: response.status, body: await response.text() }));
} };
