'use strict';
const encoder = new TextEncoder();

const TOOLS = [
  { name: 'browser_runtime_enable', description: 'Enable browser runtime explicitly and wait until ready.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_runtime_status', description: 'Return complete runtime and relay status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_runtime_disable', description: 'Disable runtime and close temporary sessions.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_request_human', description: 'Create a temporary human intervention session.', inputSchema: { type: 'object', properties: { reason: { type: 'string' }, ttlSeconds: { type: 'number' } }, required: ['reason'] } },
  { name: 'browser_human_done', description: 'Mark current human intervention complete.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_runtime_manifest', description: 'Return a portable runtime description.', inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['text', 'json'] } } } }
];

function eq(a, b) {
  const x = encoder.encode(a || ''), y = encoder.encode(b || '');
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  return d === 0;
}

function auth(req, env) {
  return Boolean(env.MCP_GATEWAY_SECRET) && eq((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.MCP_GATEWAY_SECRET);
}

function unauth() {
  return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } });
}

function rpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function err(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function text(v) { return { content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] }; }

function manifest() {
  return {
    name: 'FUF Browser Runtime MCP', version: '0.4.0', endpoint: '/mcp',
    authentication: 'Bearer MCP_GATEWAY_SECRET', activation: 'explicit only',
    tools: TOOLS.map(x => x.name)
  };
}

function htmlPage(sessionId, token) {
  const wsUrl = `wss://fuf-browser-runtime-mcp.gacfzv.workers.dev/human/${encodeURIComponent(sessionId)}/vnc?token=${encodeURIComponent(token)}`;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>FUF Browser Runtime</title>
<style>
html,body,#s{margin:0;width:100%;height:100%;background:#111;color:#eee;overflow:hidden;font-family:sans-serif}
#m{position:fixed;z-index:5;top:8px;left:8px;padding:8px 12px;background:#222d;border-radius:7px;font:13px sans-serif;max-width:80%}
#bar{position:fixed;z-index:6;bottom:0;left:0;right:0;display:none;flex-direction:column;gap:6px;background:#1a1d23;padding:8px 10px 12px;border-top:1px solid #333}
.row{display:flex;gap:6px;align-items:center}
button,input,textarea{font:16px sans-serif;color:#fff;background:#30343b;border:1px solid #555;border-radius:7px;padding:10px;box-sizing:border-box}
button{min-width:48px;cursor:pointer}
button:active{background:#444}
textarea{flex:1;resize:none;direction:auto;min-height:44px}
#login{position:fixed;z-index:10;top:50%;left:50%;transform:translate(-50%,-50%);background:#20242b;border:1px solid #555;border-radius:12px;padding:20px;width:85%;max-width:320px;text-align:center}
#pass{width:100%;margin-bottom:12px;text-align:center;font-size:18px;letter-spacing:2px}
#go{width:100%;background:#356bd8;border:none;font-weight:bold}
#go:disabled{background:#555;cursor:not-allowed}
.expired{display:grid!important;place-items:center;text-align:center;font:16px sans-serif;padding:20px}
</style>
</head>
<body>
<div id="m">في انتظار الاتصال...</div>
<div id="s"></div>

<div id="login">
  <h3 style="margin:0 0 12px;color:#eee">جلسة تدخل بشري</h3>
  <p style="margin:0 0 12px;color:#aaa;font-size:13px">أدخل كلمة المرور للاتصال</p>
  <input type="password" id="pass" placeholder="كلمة المرور" autocomplete="off">
  <button id="go">اتصال</button>
</div>

<div id="bar">
  <div class="row">
    <button id="fit" title="ملء الشاشة">⛶</button>
    <button id="back" title="مسح">⌫</button>
    <textarea id="k" rows="1" dir="auto" placeholder="اكتب هنا... (عربي/إنجليزي)"></textarea>
    <button id="enter" title="إدخال">↵</button>
  </div>
</div>

<script type="module">
import RFB from 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/core/rfb.js';

const m = document.getElementById('m');
const s = document.getElementById('s');
const k = document.getElementById('k');
const login = document.getElementById('login');
const pass = document.getElementById('pass');
const bar = document.getElementById('bar');
const go = document.getElementById('go');

let dead = 0;
let r = null;

const syms = {
  Backspace: 0xff08, Enter: 0xff0d, Tab: 0xff09, Escape: 0xff1b,
  Delete: 0xffff, ArrowLeft: 0xff51, ArrowUp: 0xff52,
  ArrowRight: 0xff53, ArrowDown: 0xff54
};

function sendKey(x, down = true) {
  if (!r || dead) return;
  const code = syms[x] ?? (x.length === 1 ? x.charCodeAt(0) : 0);
  if (code) r.sendKey(code, null, down);
}

function sendText(v) {
  if (!v || !r || dead) return;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    r.sendKey(c, null, true);
    r.sendKey(c, null, false);
  }
  m.textContent = 'تم إرسال ' + v.length + ' حرف';
}

async function connect() {
  const pwd = pass.value.trim();
  if (!pwd) { m.textContent = 'أدخل كلمة المرور'; return; }
  
  m.textContent = 'جاري الاتصال...';
  go.disabled = true;
  
  try {
    login.style.display = 'none';
    r = new RFB(s, "${wsUrl}", { credentials: { password: pwd } });
    r.scaleViewport = true;
    r.resizeSession = true;
    r.focusOnClick = true;
    
    r.addEventListener('connect', () => {
      m.textContent = 'متصل ✓';
      bar.style.display = 'flex';
      k.focus();
    });
    
    r.addEventListener('disconnect', (e) => {
      if (!dead) {
        m.textContent = 'انقطع الاتصال';
        login.style.display = 'block';
        bar.style.display = 'none';
        go.disabled = false;
        pass.value = '';
      }
    });
    
    r.addEventListener('credentialsrequired', () => {
      m.textContent = 'كلمة المرور مطلوبة';
      login.style.display = 'block';
      go.disabled = false;
    });
    
    r.addEventListener('securityfailure', () => {
      m.textContent = 'كلمة المرور غير صحيحة';
      login.style.display = 'block';
      go.disabled = false;
      pass.value = '';
      pass.focus();
    });
    
  } catch (e) {
    m.textContent = 'فشل الاتصال: ' + e.message;
    login.style.display = 'block';
    go.disabled = false;
  }
}

go.addEventListener('click', connect);
pass.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

k.addEventListener('input', () => {
  const v = k.value;
  k.value = '';
  sendText(v);
});

document.getElementById('enter').onclick = () => sendKey('Enter');
document.getElementById('back').onclick = () => sendKey('Backspace');
document.getElementById('fit').onclick = () => {
  if (r) { r.scaleViewport = true; r.resizeSession = true; r.focus(); }
};

k.addEventListener('keydown', e => {
  if (['Backspace', 'Enter', 'Tab', 'Escape'].includes(e.key) || e.key.startsWith('Arrow')) {
    e.preventDefault();
    sendKey(e.key);
  }
});

setTimeout(() => {
  dead = 1;
  if (r) r.disconnect();
  s.className = 'expired';
  s.innerHTML = '<div><h2>انتهت جلسة التدخل</h2><p>Human intervention session expired.</p><p>اطلب جلسة جديدة من المساعد.</p></div>';
  bar.remove();
  login.remove();
  m.remove();
}, 900000);
</script>
</body>
</html>`;
}

async function toBytes(data) {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(0);
}

async function envelope(id, data) {
  const b = await toBytes(data), i = encoder.encode(id), o = new Uint8Array(4 + i.length + b.length);
  new DataView(o.buffer).setUint32(0, i.length);
  o.set(i, 4);
  o.set(b, 4 + i.length);
  return o;
}

function unwrap(data) {
  const b = new Uint8Array(data), n = new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
  return { id: new TextDecoder().decode(b.slice(4, 4 + n)), data: b.slice(4 + n) };
}

export class RuntimeRelay {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.socket = null;
    this.pending = new Map();
    this.clients = new Map();
  }

  async fetch(req) {
    const u = new URL(req.url);
    if (!auth(req, this.env) && !u.pathname.startsWith('/human/')) return unauth();

    if (u.pathname === '/relay/connect' && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const p = new WebSocketPair(), client = p[0], server = p[1];
      server.accept();
      if (this.socket && this.socket.readyState === 1) this.socket.close(4001, 'replaced');
      this.socket = server;

      server.addEventListener('message', async e => {
        if (typeof e.data === 'string') {
          try {
            const m = JSON.parse(e.data), q = this.pending.get(m.id);
            if (q) { this.pending.delete(m.id); q(m); }
          } catch {}
        } else {
          try {
            const x = unwrap(await toBytes(e.data)), c = this.clients.get(x.id);
            if (c && c.readyState === 1) c.send(x.data);
          } catch {}
        }
      });

      server.addEventListener('close', () => {
        if (this.socket === server) this.socket = null;
        for (const p of this.pending.values()) p({ status: 502, body: JSON.stringify({ error: 'connector_disconnected' }) });
        this.pending.clear();
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    if (u.pathname === '/relay/action' && req.method === 'POST') {
      if (!this.socket || this.socket.readyState !== 1) return Response.json({ status: 'relay_not_connected' }, { status: 503 });
      const p = await req.json(), id = crypto.randomUUID();
      const ans = new Promise(resolve => {
        this.pending.set(id, resolve);
        setTimeout(() => { if (this.pending.delete(id)) resolve({ status: 504, body: JSON.stringify({ error: 'connector_timeout' }) }); }, 60000);
      });
      this.socket.send(JSON.stringify({ type: 'action', id, action: p.action, arguments: p.arguments || {} }));
      const r = await ans;
      return new Response(r.body || JSON.stringify(r), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
    }

    const m = u.pathname.match(/^\\/human\\/([^/]+)\\/vnc$/);
    if (m && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (!this.socket || this.socket.readyState !== 1) return new Response('relay_not_connected', { status: 503 });
      const token = u.searchParams.get('token') || '', id = crypto.randomUUID();
      const p = new WebSocketPair(), client = p[0], server = p[1];
      server.accept();
      this.clients.set(id, server);

      server.addEventListener('close', () => {
        this.clients.delete(id);
        if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'vnc_close', clientId: id }));
      });

      server.addEventListener('message', async e => {
        if (this.socket?.readyState === 1) this.socket.send(await envelope(id, e.data));
      });

      this.socket.send(JSON.stringify({ type: 'vnc_open', clientId: id, sessionId: m[1], token }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not Found', { status: 404 });
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url), relay = env.RUNTIME_RELAY;

    if (u.pathname.startsWith('/human/') && u.pathname.split('/').length === 3) {
      const id = decodeURIComponent(u.pathname.split('/')[2]);
      const token = u.searchParams.get('token') || '';
      return new Response(htmlPage(id, token), { headers: { 'content-type': 'text/html;charset=utf-8' } });
    }

    if (relay && (u.pathname === '/relay/connect' || u.pathname === '/relay/action' || u.pathname.startsWith('/human/'))) {
      if (u.pathname.startsWith('/human/') && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        return relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || 'runtime')).fetch(req);
      }
      if (!auth(req, env)) return unauth();
      return relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || 'runtime')).fetch(req);
    }

    if (!auth(req, env)) return unauth();
    if (req.method === 'GET' && u.pathname === '/health') return Response.json({ ok: true, service: 'fuf-browser-runtime-mcp' });
    if (u.pathname !== '/mcp') return new Response('Not Found', { status: 404 });
    if (req.method === 'GET') return Response.json(manifest());

    let m;
    try { m = await req.json(); } catch { return Response.json(err(null, -32700, 'Invalid JSON'), { status: 400 }); }
    const id = m.id ?? null;

    if (m.method === 'initialize') return Response.json(rpc(id, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fuf-browser-runtime-mcp', version: '0.4.0' } }));
    if (m.method === 'notifications/initialized' || m.method === 'notifications/cancelled') return new Response(null, { status: 202 });
    if (m.method === 'ping') return Response.json(rpc(id, {}));
    if (m.method === 'tools/list') return Response.json(rpc(id, { tools: TOOLS }));
    if (m.method !== 'tools/call') return Response.json(err(id, -32601, 'Method not found'));

    const name = m.params?.name, args = m.params?.arguments || {};
    if (!TOOLS.some(x => x.name === name)) return Response.json(err(id, -32602, `Unknown tool: ${name}`));
    if (name === 'browser_runtime_manifest') return Response.json(rpc(id, text(manifest())));
    if (!relay) return Response.json(rpc(id, text({ ok: false, status: 'relay_not_configured' })));

    const r = await relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || 'runtime')).fetch('https://relay.internal/relay/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.MCP_GATEWAY_SECRET}` },
      body: JSON.stringify({ action: name, arguments: args })
    });

    return Response.json(rpc(id, text({ status: r.status, body: await r.text() })));
  }
};