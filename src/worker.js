'use strict';

// ============================================
// CONSTANTS (Magic Numbers Elimination)
// ============================================
const VNC_TTL_MS = 900000; // 15 minutes
const RELAY_TIMEOUT_MS = 60000;
const WORKER_VERSION = '0.4.7';
const RELAY_ID_DEFAULT = 'runtime';

// Read-first guide exposed through the MCP skill tool.
const SKILL_TEXT = [
  '# FUF Browser Runtime: اقرأ هذا قبل استخدام المتصفح', '',
  'المتصفح قد يكون مطفأً، وهذا طبيعي وليس عطلاً. إذا أُعيد تشغيل الهاتف أو توقف Termux شغّل: cd /root/browser-agent && ./fuf up',
  '', 'استدعِ browser_runtime_skill قبل استخدام المتصفح أو طلب تدخل المستخدم.',
  'اطلب browser_request_human فقط للكابتشا أو كلمات السر أو OTP أو موافقة أمنية.',
  'بعد انتهاء المستخدم استدعِ browser_human_done فوراً. لا تحفظ كلمات السر أو أسرار الجلسات.',
  '', 'الأدوات التي بلا معاملات تحتاج note بقيمة ok لبعض العملاء؛ الخادم يتجاهله.'
].join('\n');

// ============================================
// TOOLS DEFINITION (Decoupling)
// ============================================
const TOOLS = [
  { name: 'browser_runtime_skill', description: 'READ THIS FIRST before using the browser or requesting human help.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'browser_runtime_enable', description: 'Enable browser runtime explicitly and wait until ready.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'browser_runtime_status', description: 'Return complete runtime and relay status.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'browser_runtime_disable', description: 'Disable runtime and close temporary sessions.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'browser_request_human', description: 'Create a temporary human intervention session (CAPTCHA, passwords, OTP only).', inputSchema: { type: 'object', properties: { reason: { type: 'string' }, ttlSeconds: { type: 'number' } }, required: ['reason'] } },
  { name: 'browser_human_done', description: 'Mark current human intervention complete.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'browser_runtime_manifest', description: 'Return a portable runtime description.', inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['text', 'json'] } } } }
];

// ============================================
// UTILITY FUNCTIONS (Extract Method)
// ============================================
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function timingSafeEqual(a, b) {
  const x = encoder.encode(a || ''), y = encoder.encode(b || '');
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    d |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  }
  return d === 0;
}

function isAuthenticated(req, env) {
  if (!env.MCP_GATEWAY_SECRET) return false;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return timingSafeEqual(token, env.MCP_GATEWAY_SECRET);
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' }
  });
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function textContent(v) {
  return { content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] };
}

function getManifest() {
  return {
    name: 'FUF Browser Runtime MCP',
    version: WORKER_VERSION,
    endpoint: '/mcp',
    authentication: 'Bearer MCP_GATEWAY_SECRET',
    activation: 'explicit only',
    tools: TOOLS.map(x => x.name)
  };
}

// ============================================
// HIL PAGE GENERATOR (Extract Method + Keyboard Fix)
// ============================================
function generateHilPage(sessionId, token) {
  const wsUrl = `wss://fuf-browser-runtime-mcp.gacfzv.workers.dev/human/${encodeURIComponent(sessionId)}/vnc?token=${encodeURIComponent(token)}`;
  
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>FUF Browser Runtime</title>
<style>
html,body,#s{margin:0;width:100%;height:100%;background:#111;color:#eee;overflow:hidden}
#m{position:fixed;z-index:5;top:8px;left:8px;padding:8px;background:#222d;border-radius:7px;font:13px sans-serif;max-width:60%}
#bar{position:fixed;z-index:6;bottom:0;left:0;right:0;display:none;flex-direction:column;gap:4px;background:#1a1d23;padding:6px 8px 10px;border-top:1px solid #333}
.row{display:flex;gap:6px;align-items:center}
button,input,textarea{font:16px sans-serif;color:#fff;background:#30343b;border:1px solid #555;border-radius:7px;padding:10px 8px}
button{min-width:44px;cursor:pointer}
textarea{flex:1;resize:none;direction:auto;min-height:44px}
#login{position:fixed;z-index:10;top:50%;left:50%;transform:translate(-50%,-50%);background:#20242b;border:1px solid #555;border-radius:12px;padding:20px;width:85%;max-width:320px;text-align:center}
#pass{width:100%;box-sizing:border-box;margin-bottom:12px;font-size:18px;text-align:center}
#go{width:100%;background:#356bd8;font-size:16px;font-weight:bold}
.expired{display:grid!important;place-items:center;text-align:center;font:16px sans-serif}
</style>
</head>
<body>
<div id="m">جاري التحميل…</div>
<div id="s"></div>
<div id="login">
  <h3 style="margin:0 0 12px;color:#eee">أدخل كلمة مرور جلسة VNC</h3>
  <input id="pass" type="password" placeholder="كلمة المرور" autocomplete="off">
  <button id="go">اتصال</button>
</div>
<div id="bar">
  <div class="row">
    <button id="fit">⛶</button>
    <button id="back">⌫</button>
    <textarea id="k" rows="1" dir="auto" placeholder="اكتب هنا…" inputmode="text" autocomplete="off"></textarea>
    <button id="enter">↵</button>
  </div>
</div>
<script type="module">
import RFB from 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js';

const $ = x => document.getElementById(x);
const m = $('m'), s = $('s'), k = $('k'), login = $('login'), pass = $('pass'), bar = $('bar'), go = $('go');
let dead = 0, r = null;

const syms = { Backspace: 0xff08, Enter: 0xff0d, Tab: 0xff09, Escape: 0xff1b, Delete: 0xffff, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54 };

// X11 keysyms: Latin-1 characters map to themselves; other Unicode uses the X11 Unicode range.
const LATIN1_MAX = 0xff;
const UNICODE_KEYSYM_BASE = 0x01000000;
const NEWLINE_CODE_POINT = 0x0a;

function toKeysym(codePoint) {
  if (codePoint === NEWLINE_CODE_POINT) return syms.Enter;
  return codePoint <= LATIN1_MAX ? codePoint : UNICODE_KEYSYM_BASE + codePoint;
}

// Press and release together; this also preserves repeated Backspace behavior.
function sendKey(x) {
  if (!r || dead) return;
  const isSingleChar = [...x].length === 1;
  const keysym = syms[x] ?? (isSingleChar ? toKeysym(x.codePointAt(0)) : 0);
  if (keysym) r.sendKey(keysym);
}

function sendText(v) {
  if (!v || !r || dead) return;
  let count = 0;
  for (const ch of v) {
    r.sendKey(toKeysym(ch.codePointAt(0)));
    count++;
  }
  m.textContent = 'تم إرسال ' + count + ' حرف';
}

async function connect() {
  if (!pass.value) { m.textContent = 'أدخل كلمة المرور'; return; }
  m.textContent = 'جاري الاتصال…';
  go.disabled = true;
  try {
    login.style.display = 'none';
    r = new RFB(s, ${JSON.stringify(wsUrl)});
    r.scaleViewport = true;
    r.resizeSession = true;
    r.focusOnClick = true;
    // Mobile tap safety net. noVNC remains the primary touch handler; this only
    // repairs a missing button release and never emits a second normal click.
    const display = s;
    let touch = null, lastPointer = null;
    const originalSendPointerEvent = r.sendPointerEvent.bind(r);
    r.sendPointerEvent = (x, y, mask) => {
      lastPointer = { x, y, mask, at: performance.now() };
      return originalSendPointerEvent(x, y, mask);
    };
    display.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { touch = null; return; }
      const t = e.touches[0];
      touch = { id: t.identifier, x: t.clientX, y: t.clientY };
    }, { passive: true });
    display.addEventListener('touchend', e => {
      if (!touch || !r || dead) { touch = null; return; }
      const t = [...e.changedTouches].find(x => x.identifier === touch.id);
      const start = touch;
      touch = null;
      if (!t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) return;
      const now = performance.now();
      const canvas = display.querySelector('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((t.clientX - rect.left) * canvas.width / rect.width);
      const y = Math.round((t.clientY - rect.top) * canvas.height / rect.height);
      // A complete noVNC tap needs no repair. If only button-down arrived,
      // emit only the missing release; otherwise emit the complete click.
      const recent = lastPointer && now - lastPointer.at < 250;
      if (recent && lastPointer.mask === 0) return;
      if (!(recent && (lastPointer.mask & 1))) r.sendPointerEvent(x, y, 1);
      r.sendPointerEvent(x, y, 0);
    }, { passive: true });
    display.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
    r.addEventListener('connect', () => { m.textContent = 'متصل · اكتب في الحقل السفلي'; bar.style.display = 'flex'; });
    r.addEventListener('disconnect', () => { if (!dead) { m.textContent = 'انقطع الاتصال'; login.style.display = 'block'; go.disabled = false; } });
    r.addEventListener('credentialsrequired', () => { r.sendCredentials({ password: pass.value }); });
    r.addEventListener('securityfailure', () => { login.style.display = 'block'; m.textContent = 'كلمة المرور غير صحيحة'; go.disabled = false; });
  } catch (e) {
    m.textContent = 'فشل الاتصال: ' + e.message;
    go.disabled = false;
    login.style.display = 'block';
  }
}

go.addEventListener('click', connect);
pass.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

// Keyboard fix: use compositionend for IME (Arabic) + input fallback
let composing = false;
k.addEventListener('compositionstart', () => { composing = true; });
k.addEventListener('compositionend', () => {
  composing = false;
  const v = k.value;
  k.value = '';
  sendText(v);
});
k.addEventListener('input', () => {
  if (composing) return; // Wait for compositionend for IME
  const v = k.value;
  k.value = '';
  sendText(v);
});

$('enter').addEventListener('click', () => sendKey('Enter'));

// Backspace: one tap deletes once; holding repeats without affecting other controls.
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 70;
let repeatDelayTimer = null, repeatTimer = null;
function stopRepeat() {
  clearTimeout(repeatDelayTimer);
  clearInterval(repeatTimer);
  repeatDelayTimer = null;
  repeatTimer = null;
}
function startRepeat(key) {
  stopRepeat();
  sendKey(key);
  repeatDelayTimer = setTimeout(() => {
    repeatTimer = setInterval(() => sendKey(key), REPEAT_INTERVAL_MS);
  }, REPEAT_DELAY_MS);
}
const backButton = $('back');
backButton.addEventListener('pointerdown', e => { e.preventDefault(); startRepeat('Backspace'); });
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) backButton.addEventListener(type, stopRepeat);
$('fit').addEventListener('click', () => { if (r) { r.scaleViewport = true; r.resizeSession = true; r.focus(); } });

k.addEventListener('keydown', e => {
  if (syms[e.key]) { e.preventDefault(); sendKey(e.key); }
});

setTimeout(() => {
  dead = 1;
  if (r) r.disconnect();
  s.className = 'expired';
  s.innerHTML = '<div><h2>انتهت جلسة التدخل</h2><p>Human intervention session expired.</p></div>';
  bar.remove(); login.remove(); m.remove();
}, ${VNC_TTL_MS});
</script>
</body>
</html>`;
}

// ============================================
// BINARY ENVELOPE HELPERS (Extract Method)
// ============================================
async function toBytes(data) {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(0);
}

async function createEnvelope(id, data) {
  const b = await toBytes(data), i = encoder.encode(id), o = new Uint8Array(4 + i.length + b.length);
  new DataView(o.buffer).setUint32(0, i.length);
  o.set(i, 4); o.set(b, 4 + i.length);
  return o;
}

function unwrapEnvelope(data) {
  const b = new Uint8Array(data), n = new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
  return { id: decoder.decode(b.slice(4, 4 + n)), data: b.slice(4 + n) };
}

// ============================================
// RUNTIME RELAY DURABLE OBJECT (Decoupling)
// ============================================
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
    
    // Guard Clause: Auth check (except /human/ paths)
    if (!isAuthenticated(req, this.env) && !u.pathname.startsWith('/human/')) {
      return unauthorizedResponse();
    }

    // WebSocket Relay Connect
    if (u.pathname === '/relay/connect' && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleRelayConnect(req);
    }

    // Relay Action (MCP tool calls)
    if (u.pathname === '/relay/action' && req.method === 'POST') {
      return this.handleRelayAction(req);
    }

    // VNC WebSocket Proxy (Regex fixed: no double escaping)
    const vncMatch = u.pathname.match(/^\/human\/([^\/]+)\/vnc$/);
    if (vncMatch && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleVncProxy(req, vncMatch[1]);
    }

    return new Response('Not found', { status: 404 });
  }

  async handleRelayConnect(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.socket = server;
    server.addEventListener('message', e => this.handleBridgeMessage(e));
    server.addEventListener('close', () => { this.socket = null; });
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleRelayAction(req) {
    const body = await req.json();
    const { action, arguments: args = {} } = body;
    if (!this.socket || this.socket.readyState !== 1) {
      return new Response(JSON.stringify({ ok: false, status: 'relay_not_connected' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    const id = crypto.randomUUID();
    this.socket.send(JSON.stringify({ type: 'action', id, action, arguments: args }));
    return new Promise(resolve => {
      this.pending.set(id, { resolve, timer: setTimeout(() => { this.pending.delete(id); resolve(new Response(JSON.stringify({ ok: false, status: 'relay_timeout' }), { status: 504 })); }, RELAY_TIMEOUT_MS) });
    });
  }

  async handleBridgeMessage(e) {
    let msg;
    try { msg = JSON.parse(typeof e.data === 'string' ? e.data : decoder.decode(await toBytes(e.data))); } catch { return; }
    if (msg.type === 'action_result' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(new Response(JSON.stringify(msg.result), { status: 200, headers: { 'content-type': 'application/json' } }));
      return;
    }
    if (msg.type === 'vnc_frame' && this.clients.has(msg.clientId)) {
      this.clients.get(msg.clientId).send(msg.data);
    }
  }

  async handleVncProxy(req, sessionId) {
    const token = new URL(req.url).searchParams.get('token') || '';
    const clientId = crypto.randomUUID();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.clients.set(clientId, server);
    server.addEventListener('close', () => { this.clients.delete(clientId); this.socket?.send(JSON.stringify({ type: 'vnc_close', clientId })); });
    server.addEventListener('message', async e => { if (this.socket?.readyState === 1) this.socket.send(await createEnvelope(clientId, e.data)); });
    
    this.socket.send(JSON.stringify({ type: 'vnc_open', clientId, sessionId, token }));
    return new Response(null, { status: 101, webSocket: client });
  }
}

// ============================================
// MAIN WORKER ENTRY POINT (Simplify Conditionals)
// ============================================
export default {
  async fetch(req, env) {
    const u = new URL(req.url), relay = env.RUNTIME_RELAY;

    // Guard Clause: HIL Page (no auth needed)
    if (u.pathname.startsWith('/human/') && u.pathname.split('/').length === 3) {
      const id = decodeURIComponent(u.pathname.split('/')[2]);
      const token = u.searchParams.get('token') || '';
      return new Response(generateHilPage(id, token), { headers: { 'content-type': 'text/html;charset=utf-8' } });
    }

    // Guard Clause: Relay routes
    if (relay && (u.pathname === '/relay/connect' || u.pathname === '/relay/action' || u.pathname.startsWith('/human/'))) {
      if (u.pathname.startsWith('/human/') && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        return relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || RELAY_ID_DEFAULT)).fetch(req);
      }
      if (!isAuthenticated(req, env)) return unauthorizedResponse();
      return relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || RELAY_ID_DEFAULT)).fetch(req);
    }

    // Guard Clause: Auth for everything else
    if (!isAuthenticated(req, env)) return unauthorizedResponse();

    // Health check
    if (req.method === 'GET' && u.pathname === '/health') {
      return Response.json({ ok: true, service: 'fuf-browser-runtime-mcp' });
    }

    // MCP endpoint
    if (u.pathname === '/mcp' && req.method === 'POST') {
      return this.handleMcp(req, env);
    }

    return new Response('Not found', { status: 404 });
  },

  async handleMcp(req, env) {
    let m;
    try { m = await req.json(); } catch { return Response.json(jsonRpcError(null, -32700, 'Parse error')); }
    const id = m.id ?? null;

    if (m.method === 'initialize') {
      return Response.json(jsonRpcResult(id, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fuf-browser-runtime-mcp', version: WORKER_VERSION }, instructions: 'Before using the browser, call browser_runtime_skill and follow it.' }));
    }
    if (m.method === 'notifications/initialized' || m.method === 'notifications/cancelled') {
      return new Response(null, { status: 202 });
    }
    if (m.method === 'tools/list') return Response.json(jsonRpcResult(id, { tools: TOOLS }));
    if (m.method !== 'tools/call') return Response.json(jsonRpcError(id, -32601, 'Method not found'));

    const name = m.params?.name, args = m.params?.arguments || {};
    if (!TOOLS.some(x => x.name === name)) return Response.json(jsonRpcError(id, -32602, `Unknown tool: ${name}`));
    if (name === 'browser_runtime_manifest') return Response.json(jsonRpcResult(id, textContent(getManifest())));
    if (name === 'browser_runtime_skill') return Response.json(jsonRpcResult(id, textContent(SKILL_TEXT)));
    if (!env.RUNTIME_RELAY) return Response.json(jsonRpcResult(id, textContent({ ok: false, status: 'relay_not_configured' })));

    const relay = env.RUNTIME_RELAY;
    const r = await relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || RELAY_ID_DEFAULT)).fetch('https://relay.internal/relay/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.MCP_GATEWAY_SECRET}` },
      body: JSON.stringify({ action: name, arguments: args })
    });

    return Response.json(jsonRpcResult(id, textContent({ status: r.status, body: await r.text() })));
  }
};
