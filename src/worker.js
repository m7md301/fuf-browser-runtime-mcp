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
html,body,#s{margin:0;width:100%;height:100%;background:#111;color:#eee}
#m{position:fixed;z-index:5;top:8px;left:8px;padding:8px;background:#222d;border-radius:7px;font:13px sans-serif}
#bar{position:fixed;z-index:6;bottom:12px;left:8px;right:8px;display:flex;gap:6px;background:#222d;padding:7px;border-radius:10px}
button,input,textarea{font:16px sans-serif;color:#fff;background:#30343b;border:1px solid #777;border-radius:7px;padding:8px}
button{min-width:44px}
textarea{flex:1;resize:none;direction:auto}
#login{position:fixed;z-index:10;top:55px;left:10px;right:10px;background:#20242b;border:1px solid #777;border-radius:10px;padding:12px}
#pass{width:100%;box-sizing:border-box;margin-bottom:8px}
#go{width:100%;background:#356bd8}
.expired{display:grid!important;place-items:center;text-align:center;font:16px sans-serif}
</style>
</head>
<body>
<div id="m">FUF Browser Runtime</div>
<div id="s"></div>
<div id="login">
  <div style="margin-bottom:8px;font-weight:bold">أدخل كلمة مرور جلسة VNC</div>
  <input id="pass" type="password" placeholder="كلمة المرور" autocomplete="off">
  <button id="go">اتصال</button>
</div>
<div id="bar" style="display:none">
  <button id="fit" title="ملء الشاشة">⛶</button>
  <button id="back" title="مسح">⌫</button>
  <button id="enter" title="إدخال">↵</button>
  <textarea id="k" rows="1" placeholder="اكتب هنا..." inputmode="text" autocomplete="off"></textarea>
</div>
<script type="module">
const $=x=>document.getElementById(x),m=$('m'),s=$('s'),k=$('k'),login=$('login'),pass=$('pass'),bar=$('bar'),go=$('go'),enter=$('enter'),back=$('back'),fit=$('fit');
let dead=0,r=null;
const z={Backspace:0xff08,Enter:0xff0d,Tab:0xff09,Escape:0xff1b,Delete:0xffff,ArrowLeft:0xff51,ArrowUp:0xff52,ArrowRight:0xff53,ArrowDown:0xff54};
function key(x,d=true){if(!r||dead)return;const n=z[x]??(x.length===1?x.toLowerCase().charCodeAt(0):0);if(n)r.sendKey(n,null,d)}
function paste(v){if(!v||!r||dead)return;for(const c of v){const code=c.charCodeAt(0);r.sendKey(code,null,true);r.sendKey(code,null,false)}m.textContent='تم إرسال '+v.length+' حرف'}
async function connect(){
  if(!pass.value){m.textContent='أدخل كلمة المرور';return}
  m.textContent='جاري تحميل اتصال VNC…';go.disabled=true;
  try{
    const mod=await import('https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/lib/rfb.js/+esm'),RFB=mod.default?.default||mod.default||mod.RFB;
    if(typeof RFB!=='function')throw Error('RFB unavailable');
    login.style.display='none';m.textContent='Connecting…';
    r=new RFB(s,"wss://fuf-browser-runtime-mcp.gacfzv.workers.dev/human/${sessionId}/vnc?token=${token}",{credentials:{password:pass.value}});
    r.scaleViewport=true;r.resizeSession=true;r.focusOnClick=true;
    r.addEventListener('connect',()=>{m.textContent='Connected';bar.style.display='flex'});
    r.addEventListener('disconnect',()=>{if(!dead){m.textContent='انقطع الاتصال';login.style.display='block';go.disabled=false}});
    r.addEventListener('credentialsrequired',()=>{login.style.display='block';m.textContent='كلمة المرور مطلوبة';go.disabled=false});
    r.addEventListener('securityfailure',()=>{login.style.display='block';m.textContent='كلمة المرور غير صحيحة';go.disabled=false})
  }catch(e){m.textContent='فشل تحميل noVNC: '+e.message;go.disabled=false;login.style.display='block'}
}
go.addEventListener('click',connect);
pass.addEventListener('keydown',e=>{if(e.key==='Enter')connect()});
k.addEventListener('input',()=>{const v=k.value;k.value='';paste(v)});
enter.addEventListener('click',()=>key('Enter'));
back.addEventListener('click',()=>key('Backspace'));
fit.addEventListener('click',()=>{if(r){r.scaleViewport=true;r.resizeSession=true;r.focus()}});
k.addEventListener('keydown',e=>{if(z[e.key]){e.preventDefault();key(e.key)}});
setTimeout(()=>{dead=1;if(r)r.disconnect();s.className='expired';s.innerHTML='انتهت جلسة التدخل<br>Human intervention session expired.';bar.remove();login.remove();m.remove()},900000);
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // MCP endpoint
    if (path === '/mcp' || path === '/mcp/') {
      return handleMCP(request, env);
    }

    // Human session page
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
      if (!token) return new Response('Missing token', { status: 400 });

      const relay = env.RUNTIME_RELAY;
      if (!relay) return new Response('Relay not configured', { status: 500 });

      const id = env.RUNTIME_RELAY_ID || RELAY_ID;
      const stub = relay.get(id);

      const pair = new WebSocketPair();
      const [client, server] = pair;

      // Accept the client WebSocket
      server.accept();

      // Connect to the relay Durable Object
      const relayUrl = `${url.origin}/relay/connect?session=${sessionId}&token=${token}`;
      
      // Use the Durable Object's WebSocket hibernation API
      try {
        const relayResponse = await stub.fetch(new Request(relayUrl, {
          headers: { 'Upgrade': 'websocket' }
        }));
        
        if (relayResponse.status !== 101) {
          server.close(1008, 'Relay connection failed');
          return new Response(null, { status: 101, webSocket: client });
        }

        const relayWs = relayResponse.webSocket;
        relayWs.accept();

        // Bidirectional relay
        server.addEventListener('message', (e) => {
          try { relayWs.send(e.data); } catch (_) {}
        });
        server.addEventListener('close', () => {
          try { relayWs.close(); } catch (_) {}
        });
        relayWs.addEventListener('message', (e) => {
          try { server.send(e.data); } catch (_) {}
        });
        relayWs.addEventListener('close', () => {
          try { server.close(); } catch (_) {}
        });
      } catch (e) {
        server.close(1011, 'Relay error: ' + e.message);
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // Relay connect endpoint (for Bridge)
    if (path === '/relay/connect') {
      const relay = env.RUNTIME_RELAY;
      if (!relay) return new Response('Relay not configured', { status: 500 });
      const id = env.RUNTIME_RELAY_ID || RELAY_ID;
      const stub = relay.get(id);
      return stub.fetch(request);
    }

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'content-type': 'application/json' }
      });
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
