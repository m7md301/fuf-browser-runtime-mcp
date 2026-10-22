'use strict';

// ============================================
// CONSTANTS (Magic Numbers Elimination)
// ============================================
const VNC_TTL_MS = 900000; // 15 minutes
const RELAY_TIMEOUT_MS = 60000;
const WORKER_VERSION = '0.4.7';
const RELAY_ID_DEFAULT = 'runtime';
const NOVNC_RFB_URL = 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js';


// ============================================
// SKILL TEXT (read-first guide for any agent using this runtime)
// ============================================
const SKILL_TEXT = [
  '# FUF Browser Runtime: اقرأ هذا قبل استخدام المتصفح',
  '',
  'متصفح Chromium دائم يعمل على جهاز المستخدم، تتحكم به أنت. وجلسة تدخل بشري مؤقتة يستخدمها المستخدم فقط للكابتشا وكلمات السر والتحقق بخطوتين. بعد أن ينتهي يكمل المساعد من نفس المتصفح ونفس التبويبات.',
  '',
  '## 1. كيف تبدأ',
  '',
  'المتصفح قد يكون مطفأً، وهذا طبيعي وليس عطلاً. لا يعمل من نفسه: إذا أُعيد تشغيل الهاتف أو أوقف النظام Termux تتوقف كل الأجزاء. وتشغيله أمر واحد، وأنت من يشغّله، لا تطلب من المستخدم شيئاً.',
  '',
  'الحالة الأولى: عندك shell على الجهاز (المسار /root/browser-agent). شغّل هذا الأمر فقط ولا تفحص قبله:',
  '',
  '    cd /root/browser-agent && ./fuf up',
  '',
  'آمن للتكرار، ويشغّل المتصفح والشاشة والجسر ومراقب الجسر. إن ظهر خلل شغّل ./fuf doctor فيكتب لك سبب كل خلل وأمر إصلاحه. لا تخمّن منافذ أو مسارات بديلة.',
  '',
  'علامات أن المتصفح مطفأ: browser_runtime_status يرجع chromium أو cdp بقيمة false، أو ./fuf status يكتب «لا» أمام المتصفح، أو يفشل أي أمر ./fuf browse. الحل دائماً ./fuf up ثم أعد المحاولة.',
  '',
  'الحالة الثانية: ليس عندك shell. استدعِ browser_runtime_status. إن كان المتصفح مطفأً فجرّب browser_runtime_enable. وإن رجعت الأدوات relay_not_connected أو 503 فالجسر نفسه مطفأ ولا يمكن تشغيله عن بُعد، فأخبر المستخدم أن يشغّل في Termux هذا الأمر فقط: cd /root/browser-agent && ./fuf up',
  '',
  '## 2. التحكم بالمتصفح (من shell)',
  '',
  '    ./fuf browse navigate <رابط>      فتح صفحة',
  '    ./fuf browse snapshot             قراءة النص والعناصر',
  '    ./fuf browse click <نص>           ضغط عنصر',
  '    ./fuf browse type <نص>            كتابة في الحقل المحدد',
  '    ./fuf browse press Enter          ضغط مفتاح',
  '    ./fuf browse screenshot <اسم>     لقطة شاشة',
  '    ./fuf browse tabs                 التبويبات المفتوحة (لترى ما فتحه المستخدم)',
  '',
  'المتصفح المحلي هو المسار الأساسي. أدوات MCP هذه لإدارة الجلسة وطلب المستخدم، وليست للتحكم بالصفحات.',
  '',
  '## 3. متى تطلب تدخل المستخدم',
  '',
  'استدعِ browser_request_human فقط عند:',
  '- كابتشا أو تحدٍّ مرئي يحتاج إنساناً.',
  '- كلمة سر لا يجب أن تقرأها أو تخزنها.',
  '- رمز OTP أو تحقق بخطوتين يكتبه المستخدم.',
  '- موافقة أمنية لا يصح أن تنفذها نيابة عنه.',
  '',
  'لا تطلبه لأن الصفحة بطيئة أو لأن عنصراً يحتاج ضغطة عادية. جرّب التحكم المحلي أولاً. ولا تحاول حل الكابتشا أو تجاوزها بنفسك.',
  '',
  '## 4. خطوات الجلسة البشرية',
  '',
  '1. أوصل المتصفح إلى الصفحة الصحيحة أولاً.',
  '2. استدعِ browser_request_human مع reason واضح وttlSeconds (الأقصى 900).',
  '3. اعرض للمستخدم الرابط وكلمة السر فقط. لا تحفظهما في الذاكرة أو الملفات.',
  '4. انتظر حتى يقول إنه انتهى.',
  '5. استدعِ browser_human_done فوراً ثم أكمل المهمة من نفس التبويب.',
  '',
  'الجلسة تنتهي وحدها بعد 15 دقيقة كحد أقصى. إن انتهت قبل أن يفتح الرابط فأنشئ جلسة جديدة ولا تعيد استخدام القديمة. بعد browser_human_done يبقى Chromium شغالاً.',
  '',
  '## 5. أدوات MCP',
  '',
  'الأدوات التي بلا معاملات (status وenable وdisable وhuman_done وskill) تحتاج معاملاً اسمه note: مرّر note بقيمة ok. الخادم يتجاهله، لكن بعض العملاء يفشلون بـ Failed to parse arguments إن أُرسلت أداة بلا وسيطات.',
  '',
  '- browser_runtime_skill: هذا الدليل.',
  '- browser_runtime_status: حالة Chromium وXvfb والجسر والاتصال والجلسة البشرية.',
  '- browser_runtime_enable: تشغيل المتصفح صراحة. لا يعيد أسرار جلسة قديمة.',
  '- browser_request_human: جلسة بشرية جديدة (رابط وكلمة سر).',
  '- browser_human_done: إنهاء الجلسة البشرية فقط.',
  '- browser_runtime_disable: إنهاء الجلسة البشرية المؤقتة.',
  '- browser_runtime_manifest: وصف مختصر للخدمة.',
  '',
  '## 6. قواعد',
  '',
  '- لا تغلق Chromium ولا تحذف مجلد profile: فيه جلسات المستخدم.',
  '- لا تستخدم ./fuf down أثناء مهمة جارية إلا بطلب صريح.',
  '- لا تكتب MCP_GATEWAY_SECRET ولا كلمات سر الجلسات في الذاكرة.',
  '- مانع الإعلانات مفعّل. إن كسر موقعاً فعدّل إعداده للموقع بدل إزالته.',
  '- الصفحة البشرية تدعم العربية والإنجليزية والحذف.'
].join('\n');

// ============================================
// TOOLS DEFINITION (Decoupling)
// ============================================
const TOOLS = [
  { name: 'browser_runtime_skill', description: 'READ THIS FIRST before using the browser or requesting human help. Returns the usage guide: how to start, when to request the user, and the exact steps.', inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'Pass any short text such as ok. Ignored by the server. It exists only so clients always send valid JSON arguments.' } }, required: ['note'] } },
  { name: 'browser_runtime_enable', description: 'Enable browser runtime explicitly and wait until ready.', inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'Pass any short text such as ok. Ignored by the server. It exists only so clients always send valid JSON arguments.' } }, required: ['note'] } },
  { name: 'browser_runtime_status', description: 'Return complete runtime and relay status.', inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'Pass any short text such as ok. Ignored by the server. It exists only so clients always send valid JSON arguments.' } }, required: ['note'] } },
  { name: 'browser_runtime_disable', description: 'Disable runtime and close temporary sessions.', inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'Pass any short text such as ok. Ignored by the server. It exists only so clients always send valid JSON arguments.' } }, required: ['note'] } },
  { name: 'browser_request_human', description: 'Create a temporary human intervention session (CAPTCHA, passwords, OTP only). Call browser_runtime_skill first if you have not read it.', inputSchema: { type: 'object', properties: { reason: { type: 'string' }, ttlSeconds: { type: 'number' } }, required: ['reason'] } },
  { name: 'browser_human_done', description: 'Mark current human intervention complete.', inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'Pass any short text such as ok. Ignored by the server. It exists only so clients always send valid JSON arguments.' } }, required: ['note'] } },
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
// HIL PAGE GENERATOR (Extract Method + Keyboard Fix + RFB Fix)
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
import RFB from '${NOVNC_RFB_URL}';

const $ = x => document.getElementById(x);
const m = $('m'), s = $('s'), k = $('k'), login = $('login'), pass = $('pass'), bar = $('bar'), go = $('go');
let dead = 0, r = null;

const syms = { Backspace: 0xff08, Enter: 0xff0d, Tab: 0xff09, Escape: 0xff1b, Delete: 0xffff, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54 };

// X11 keysyms: Latin-1 characters map to themselves; any other Unicode
// character (Arabic, emoji, ...) is 0x01000000 + its code point.
const LATIN1_MAX = 0xff;
const UNICODE_KEYSYM_BASE = 0x01000000;
const NEWLINE_CODE_POINT = 0x0a;

function toKeysym(codePoint) {
  if (codePoint === NEWLINE_CODE_POINT) return syms.Enter;
  return codePoint <= LATIN1_MAX ? codePoint : UNICODE_KEYSYM_BASE + codePoint;
}

// Press and release together: noVNC sends both events when the down argument is omitted.
// Sending only "down" made x11vnc drop repeated presses (Backspace worked once).
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
    const keysym = toKeysym(ch.codePointAt(0));
    r.sendKey(keysym);
    count++;
  }
  m.textContent = 'تم إرسال ' + count + ' حرف';
}

function connect() {
  if (!pass.value) { m.textContent = 'أدخل كلمة المرور'; return; }
  m.textContent = 'جاري الاتصال…';
  go.disabled = true;
  try {
    login.style.display = 'none';
    r = new RFB(s, ${JSON.stringify(wsUrl)});
    r.scaleViewport = true;
    r.resizeSession = true;
    r.focusOnClick = true;
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
  if (composing) return;
  const v = k.value;
  k.value = '';
  sendText(v);
});

$('enter').addEventListener('click', () => sendKey('Enter'));

// Backspace button: one tap deletes one character; holding repeats.
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 70;
let repeatDelayTimer = null, repeatTimer = null;

function stopRepeat() {
  clearTimeout(repeatDelayTimer);
  clearInterval(repeatTimer);
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
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
  backButton.addEventListener(type, stopRepeat);
}
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
    
    if (!isAuthenticated(req, this.env) && !u.pathname.startsWith('/human/')) {
      return unauthorizedResponse();
    }

    if (u.pathname === '/relay/connect' && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleRelayConnect(req);
    }

    if (u.pathname === '/relay/action' && req.method === 'POST') {
      return this.handleRelayAction(req);
    }

    const vncMatch = u.pathname.match(/^\/human\/([^\/]+)\/vnc$/);
    if (vncMatch && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleVncProxy(req, vncMatch[1]);
    }

    return new Response('Not Found', { status: 404 });
  }

  handleRelayConnect(req) {
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
          const x = unwrapEnvelope(await toBytes(e.data)), c = this.clients.get(x.id);
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

  async handleRelayAction(req) {
    if (!this.socket || this.socket.readyState !== 1) {
      return Response.json({ status: 'relay_not_connected' }, { status: 503 });
    }
    const p = await req.json(), id = crypto.randomUUID();
    const ans = new Promise(resolve => {
      this.pending.set(id, resolve);
      setTimeout(() => { if (this.pending.delete(id)) resolve({ status: 504, body: JSON.stringify({ error: 'connector_timeout' }) }); }, RELAY_TIMEOUT_MS);
    });
    this.socket.send(JSON.stringify({ type: 'action', id, action: p.action, arguments: p.arguments || {} }));
    const r = await ans;
    return new Response(r.body || JSON.stringify(r), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
  }

  handleVncProxy(req, sessionId) {
    if (!this.socket || this.socket.readyState !== 1) {
      return new Response('relay_not_connected', { status: 503 });
    }
    const token = new URL(req.url).searchParams.get('token') || '', id = crypto.randomUUID();
    const p = new WebSocketPair(), client = p[0], server = p[1];
    server.accept();
    this.clients.set(id, server);
    
    server.addEventListener('close', () => {
      this.clients.delete(id);
      if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'vnc_close', clientId: id }));
    });
    
    server.addEventListener('message', async e => {
      if (this.socket?.readyState === 1) this.socket.send(await createEnvelope(id, e.data));
    });
    
    this.socket.send(JSON.stringify({ type: 'vnc_open', clientId: id, sessionId, token }));
    return new Response(null, { status: 101, webSocket: client });
  }
}

// ============================================
// MAIN WORKER ENTRY POINT (Simplify Conditionals)
// ============================================
export default {
  async fetch(req, env) {
    const u = new URL(req.url), relay = env.RUNTIME_RELAY;

    if (u.pathname.startsWith('/human/') && u.pathname.split('/').length === 3) {
      const id = decodeURIComponent(u.pathname.split('/')[2]);
      const token = u.searchParams.get('token') || '';
      return new Response(generateHilPage(id, token), { headers: { 'content-type': 'text/html;charset=utf-8' } });
    }

    if (relay && (u.pathname === '/relay/connect' || u.pathname === '/relay/action' || u.pathname.startsWith('/human/'))) {
      if (u.pathname.startsWith('/human/') && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        return relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || RELAY_ID_DEFAULT)).fetch(req);
      }
      if (!isAuthenticated(req, env)) return unauthorizedResponse();
      return relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || RELAY_ID_DEFAULT)).fetch(req);
    }

    if (!isAuthenticated(req, env)) return unauthorizedResponse();

    if (req.method === 'GET' && u.pathname === '/health') {
      return Response.json({ ok: true, service: 'fuf-browser-runtime-mcp' });
    }

    if (u.pathname !== '/mcp') return new Response('Not Found', { status: 404 });
    if (req.method === 'GET') return Response.json(getManifest());

    let m;
    try { m = await req.json(); } catch { return Response.json(jsonRpcError(null, -32700, 'Invalid JSON'), { status: 400 }); }
    const id = m.id ?? null;

    if (m.method === 'initialize') {
      return Response.json(jsonRpcResult(id, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fuf-browser-runtime-mcp', version: WORKER_VERSION }, instructions: 'Before using the browser, call browser_runtime_skill and follow it.' }));
    }
    if (m.method === 'notifications/initialized' || m.method === 'notifications/cancelled') {
      return new Response(null, { status: 202 });
    }
    if (m.method === 'ping') return Response.json(jsonRpcResult(id, {}));
    if (m.method === 'tools/list') return Response.json(jsonRpcResult(id, { tools: TOOLS }));
    if (m.method !== 'tools/call') return Response.json(jsonRpcError(id, -32601, 'Method not found'));

    const name = m.params?.name, args = m.params?.arguments || {};
    if (!TOOLS.some(x => x.name === name)) return Response.json(jsonRpcError(id, -32602, `Unknown tool: ${name}`));
    if (name === 'browser_runtime_manifest') return Response.json(jsonRpcResult(id, textContent(getManifest())));
    if (name === 'browser_runtime_skill') return Response.json(jsonRpcResult(id, textContent(SKILL_TEXT)));
    if (!relay) return Response.json(jsonRpcResult(id, textContent({ ok: false, status: 'relay_not_configured' })));

    const r = await relay.get(relay.idFromName(env.RUNTIME_RELAY_ID || RELAY_ID_DEFAULT)).fetch('https://relay.internal/relay/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.MCP_GATEWAY_SECRET}` },
      body: JSON.stringify({ action: name, arguments: args })
    });

    return Response.json(jsonRpcResult(id, textContent({ status: r.status, body: await r.text() })));
  }
};
