// FUF Browser Runtime - Cloudflare Worker
// Serves HIL (Human-in-the-Loop) pages and relays VNC WebSocket to Bridge via Durable Object

const RELAY_ID = 'runtime';

function htmlPage(sessionId, token) {
  return `<!DOCTYPE html>
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
button,input,textarea{font:16px sans-serif;color:#fff;background:#30343b;border:1px solid #555;border-radius:7px;padding:8px;outline:none}
button{min-width:44px;cursor:pointer;active:opacity:.7}
button:active{background:#444}
textarea{flex:1;resize:none;direction:auto;min-height:40px;max-height:80px;font-size:16px}
#login{position:fixed;z-index:10;top:50%;left:50%;transform:translate(-50%,-50%);background:#20242b;border:1px solid #555;border-radius:12px;padding:20px;width:280px;text-align:center}
#pass{width:100%;box-sizing:border-box;margin-bottom:10px;font-size:18px;text-align:center}
#go{width:100%;background:#356bd8;font-size:16px;padding:10px}
.expired{display:grid!important;place-items:center;text-align:center;font:18px sans-serif;padding:20px}
.kbtn{font-size:20px;padding:10px 14px;min-width:48px}
</style>
</head>
<body>
<div id="m">في انتظار الاتصال…</div>
<div id="s"></div>
<div id="login">
  <div style="margin-bottom:12px;font-size:15px">أدخل كلمة مرور جلسة VNC</div>
  <input id="pass" type="password" placeholder="كلمة المرور" autocomplete="off">
  <button id="go">اتصال</button>
</div>
<div id="bar">
  <div class="row">
    <textarea id="k" placeholder="اكتب هنا ثم اضغط إرسال…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text"></textarea>
    <button id="send" style="background:#356bd8;min-width:60px">إرسال</button>
  </div>
  <div class="row">
    <button class="kbtn" id="back">⌫</button>
    <button class="kbtn" id="enter">↵</button>
    <button class="kbtn" id="tab">⇥</button>
    <button class="kbtn" id="esc">Esc</button>
    <button id="fit" style="flex:1">⛶ ملء الشاشة</button>
  </div>
</div>
<script type="module">
const $=x=>document.getElementById(x),m=$('m'),s=$('s'),k=$('k'),login=$('login'),pass=$('pass'),bar=$('bar'),go=$('go');
let dead=0,r=null;
const z={Backspace:0xff08,Enter:0xff0d,Tab:0xff09,Escape:0xff1b,Delete:0xffff,ArrowLeft:0xff51,ArrowUp:0xff52,ArrowRight:0xff53,ArrowDown:0xff54};

function sendKeySym(sym,down=true){
  if(!r||dead)return;
  try{r.sendKey(sym,null,down)}catch(e){}
}

function sendChar(ch){
  if(!r||dead)return;
  const code=ch.charCodeAt(0);
  if(code<128){
    // ASCII: send as keysym directly
    const sym=ch.toLowerCase().charCodeAt(0);
    sendKeySym(sym,true);
    setTimeout(()=>sendKeySym(sym,false),50);
  } else {
    // Non-ASCII (Arabic etc): use clipboard paste
    try{
      r.clipboardPasteFrom(ch);
    }catch(e){
      m.textContent='تعذر إرسال: '+e.message;
    }
  }
}

function sendText(text){
  if(!text||!r||dead)return;
  // Send character by character with small delays for reliability
  let i=0;
  function next(){
    if(i>=text.length||dead)return;
    sendChar(text[i]);
    i++;
    if(i<text.length)setTimeout(next,30);
  }
  next();
  m.textContent='تم إرسال '+text.length+' حرف';
  setTimeout(()=>{if(!dead)m.textContent='Connected'},1500);
}

async function connect(){
  if(!pass.value){m.textContent='أدخل كلمة المرور';return}
  m.textContent='جاري الاتصال…';
  go.disabled=true;
  try{
    const mod=await import('https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/lib/rfb.js/+esm');
    const RFB=mod.default?.default||mod.default||mod.RFB;
    if(typeof RFB!=='function')throw Error('RFB unavailable');
    login.style.display='none';
    m.textContent='Connecting…';
    const wsUrl='wss://${new URL(`https://fuf-browser-runtime-mcp.gacfzv.workers.dev`).host}/human/${sessionId}/vnc?token=${token}';
    r=new RFB(s,wsUrl,{credentials:{password:pass.value}});
    r.scaleViewport=true;
    r.resizeSession=true;
    r.focusOnClick=true;
    r.addEventListener('connect',()=>{
      m.textContent='Connected';
      bar.style.display='flex';
      k.focus();
    });
    r.addEventListener('disconnect',()=>{
      if(!dead){
        m.textContent='انقطع الاتصال';
        login.style.display='block';
        go.disabled=false;
        bar.style.display='none';
      }
    });
    r.addEventListener('credentialsrequired',()=>{
      login.style.display='block';
      m.textContent='كلمة المرور مطلوبة';
      go.disabled=false;
    });
    r.addEventListener('securityfailure',()=>{
      login.style.display='block';
      m.textContent='كلمة المرور غير صحيحة';
      go.disabled=false;
    });
  }catch(e){
    m.textContent='فشل: '+e.message;
    go.disabled=false;
    login.style.display='block';
  }
}

go.addEventListener('click',connect);
pass.addEventListener('keydown',e=>{if(e.key==='Enter')connect()});

// Send button: sends all text in textarea
$('send').addEventListener('click',()=>{
  const v=k.value.trim();
  if(v){sendText(v);k.value=''}
});

// Also send on Enter in textarea (Shift+Enter for newline)
k.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    const v=k.value.trim();
    if(v){sendText(v);k.value=''}
    // Also send Enter key after text
    setTimeout(()=>sendKeySym(0xff0d,true),100);
    setTimeout(()=>sendKeySym(0xff0d,false),150);
  }
  // Special keys
  if(z[e.key]){
    e.preventDefault();
    sendKeySym(z[e.key],true);
    setTimeout(()=>sendKeySym(z[e.key],false),50);
  }
});

$('enter').addEventListener('click',()=>{sendKeySym(0xff0d,true);setTimeout(()=>sendKeySym(0xff0d,false),50)});
$('back').addEventListener('click',()=>{sendKeySym(0xff08,true);setTimeout(()=>sendKeySym(0xff08,false),50)});
$('tab').addEventListener('click',()=>{sendKeySym(0xff09,true);setTimeout(()=>sendKeySym(0xff09,false),50)});
$('esc').addEventListener('click',()=>{sendKeySym(0xff1b,true);setTimeout(()=>sendKeySym(0xff1b,false),50)});
$('fit').addEventListener('click',()=>{if(r){r.scaleViewport=true;r.resizeSession=true;r.focus()}});

// Auto-focus textarea when tapping on canvas area
s.addEventListener('click',()=>{if(r&&!dead)k.focus()});

// TTL expiry
setTimeout(()=>{
  dead=1;
  if(r)r.disconnect();
  s.className='expired';
  s.innerHTML='<div>انتهت جلسة التدخل<br><small>Human intervention session expired.</small></div>';
  bar.remove();login.remove();m.remove();
},900000);
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // MCP endpoint
    if (path === '/mcp') {
      return handleMCP(request, env);
    }

    // Human HIL page
    const humanMatch = path.match(/^\\/human\\/([^\\/]+)$/);
    if (humanMatch && request.method === 'GET') {
      const sessionId = humanMatch[1];
      const token = url.searchParams.get('token');
      if (!token) return new Response('Missing token', { status: 400 });
      return new Response(htmlPage(sessionId, token), {
        headers: { 'content-type': 'text/html;charset=utf-8' }
      });
    }

    // VNC WebSocket relay
    const vncMatch = path.match(/^\\/human\\/([^\\/]+)\\/vnc$/);
    if (vncMatch && request.headers.get('Upgrade') === 'websocket') {
      const sessionId = vncMatch[1];
      const token = url.searchParams.get('token');
      if (!token) return new Response('Missing token', { status: 401 });

      const relayId = env.RUNTIME_RELAY_ID || RELAY_ID;
      const relay = env.RUNTIME_RELAY.get(env.RUNTIME_RELAY.idFromName(relayId));

      // Create a pair: client <-> worker <-> relay
      const { 0: clientWs, 1: workerWs } = new WebSocketPair();
      workerWs.accept();

      // Connect to relay
      const relayUrl = new URL(request.url);
      relayUrl.pathname = '/relay/connect';
      relayUrl.searchParams.set('session', sessionId);
      relayUrl.searchParams.set('token', token);
      relayUrl.searchParams.set('type', 'vnc');

      const relayResp = await relay.fetch(relayUrl.toString(), {
        headers: { Upgrade: 'websocket' },
      });

      if (relayResp.status !== 101) {
        workerWs.close(1006, 'Relay connection failed');
        return new Response('Relay failed', { status: 502 });
      }

      const relayWs = relayResp.webSocket;
      relayWs.accept();

      // Bridge: client <-> relay
      workerWs.addEventListener('message', (e) => {
        try { relayWs.send(e.data); } catch (_) {}
      });
      workerWs.addEventListener('close', () => {
        try { relayWs.close(); } catch (_) {}
      });
      relayWs.addEventListener('message', (e) => {
        try { workerWs.send(e.data); } catch (_) {}
      });
      relayWs.addEventListener('close', () => {
        try { workerWs.close(); } catch (_) {}
      });

      return new Response(null, { status: 101, webSocket: clientWs });
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleMCP(request, env) {
  // Simplified MCP handler - delegates to the actual MCP logic
  // This is a placeholder; the real MCP handling is in the deployed worker
  return new Response(JSON.stringify({ error: 'Use the /mcp endpoint with proper MCP protocol' }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
}
