import express, { Request, Response } from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.env.PORT ?? '18800', 10);
const BASE = process.env.BASE_PATH ?? '';          // e.g. /ochat

// Allow overriding the openclaw invocation, e.g.:
//   OPENCLAW_BIN="node /usr/lib/node_modules/openclaw/openclaw.mjs"
const OPENCLAW_RAW = process.env.OPENCLAW_BIN ?? 'openclaw';
const [OPENCLAW_CMD, ...OPENCLAW_EXTRA] = OPENCLAW_RAW.split(' ');

const app = express();
app.use(express.json());

// ─── HTML ────────────────────────────────────────────────────────────────────
function html(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenClaw Chat</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0f0f12;color:#e2e8f0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
header{padding:14px 20px;background:#131320;border-bottom:1px solid #22223a;display:flex;align-items:center;gap:12px;flex-shrink:0}
.logo{font-size:1.5em}
h1{font-size:1em;font-weight:600;letter-spacing:.02em}
.sub{font-size:.75em;color:#4a4a7a;margin-top:2px}
#messages{flex:1;overflow-y:auto;padding:20px 16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.msg{max-width:82%;padding:10px 14px;border-radius:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;font-size:.93em}
.msg.user{align-self:flex-end;background:#2d2d8f;border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:#1a1a2e;border:1px solid #2a2a45;border-bottom-left-radius:4px}
.msg.system{align-self:center;background:transparent;color:#4a4a6a;font-size:.8em;text-align:center;padding:4px 0}
.typing{align-self:flex-start;padding:10px 16px;background:#1a1a2e;border:1px solid #2a2a45;border-radius:14px;border-bottom-left-radius:4px}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4a4a7a;margin:0 2px;animation:bop 1.2s ease-in-out infinite}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes bop{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
footer{padding:12px 14px;background:#131320;border-top:1px solid #22223a;display:flex;gap:8px;flex-shrink:0}
textarea{flex:1;background:#0d0d1a;border:1px solid #22223a;border-radius:10px;color:#e2e8f0;padding:10px 12px;font-size:.93em;resize:none;font-family:inherit;min-height:44px;max-height:130px;line-height:1.5}
textarea:focus{outline:none;border-color:#3a3a8f}
button{background:#2d2d8f;color:#e2e8f0;border:none;border-radius:10px;padding:0 18px;cursor:pointer;font-size:.9em;font-weight:600;transition:background .15s}
button:hover:not(:disabled){background:#3d3dbf}
button:disabled{opacity:.45;cursor:not-allowed}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a45;border-radius:2px}
</style>
</head>
<body>
<header>
  <span class="logo">🦞</span>
  <div>
    <h1>OpenClaw Chat</h1>
    <div class="sub" id="sid">carregando...</div>
  </div>
</header>
<div id="messages">
  <div class="msg system">Conversa iniciada. Pode digitar.</div>
</div>
<footer>
  <textarea id="inp" placeholder="Mensagem…" rows="1" onkeydown="onKey(event)"></textarea>
  <button id="btn" onclick="send()">Enviar</button>
</footer>
<script>
const BASE='${BASE}';
let sid=sessionStorage.getItem('ochat_sid');
if(!sid){sid=crypto.randomUUID();sessionStorage.setItem('ochat_sid',sid);}
document.getElementById('sid').textContent='sessão '+sid.slice(0,8)+'…';

function addMsg(role,text){
  const el=document.createElement('div');
  el.className='msg '+role;
  el.textContent=text;
  const box=document.getElementById('messages');
  box.appendChild(el);
  box.scrollTop=box.scrollHeight;
  return el;
}
function showTyping(){
  const el=document.createElement('div');
  el.className='typing';el.id='typ';
  el.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  const box=document.getElementById('messages');
  box.appendChild(el);box.scrollTop=box.scrollHeight;
}
function hideTyping(){const e=document.getElementById('typ');if(e)e.remove();}
function onKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}

const inp=document.getElementById('inp');
inp.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,130)+'px';});

async function send(){
  const btn=document.getElementById('btn');
  const msg=inp.value.trim();
  if(!msg||btn.disabled)return;
  inp.value='';inp.style.height='auto';btn.disabled=true;
  addMsg('user',msg);showTyping();
  try{
    const r=await fetch(BASE+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,sessionId:sid})});
    const d=await r.json();
    hideTyping();
    if(d.ok){addMsg('assistant',d.text);}
    else{addMsg('system','Erro: '+(d.error||'resposta inválida'));}
  }catch(e){
    hideTyping();
    addMsg('system','Erro de conexão: '+e.message);
  }
  btn.disabled=false;inp.focus();
}
</script>
</body></html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get(['/', '/index.html'], (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html());
});

app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

app.post('/api/chat', (req: Request, res: Response) => {
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };

  if (!message?.trim()) {
    res.status(400).json({ ok: false, error: 'message required' });
    return;
  }

  const sid = sessionId?.trim() || randomUUID();

  // openclaw agent --session-id <sid> --message <msg> --json
  const args = [...OPENCLAW_EXTRA, 'agent', '--session-id', sid, '--message', message.trim(), '--json'];

  const child = spawn(OPENCLAW_CMD, args, {
    timeout: 120_000,
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

  child.on('close', (code: number | null) => {
    // Strip any leading lines before the JSON (e.g. openclaw banner)
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]) as {
          payloads?: Array<{ text: string }>;
          text?: string;
        };
        const text = result.payloads?.[0]?.text ?? result.text ?? stdout.trim();
        res.json({ ok: true, text, sessionId: sid });
        return;
      } catch {
        // fall through
      }
    }

    const text = stdout.trim() || stderr.trim();
    if (code === 0 || text) {
      res.json({ ok: true, text: text || '(sem resposta)', sessionId: sid });
    } else {
      res.json({ ok: false, error: stderr.trim() || 'agent error', sessionId: sid });
    }
  });

  child.on('error', (err: Error) => {
    res.json({ ok: false, error: err.message, sessionId: sid });
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ochat listening on 0.0.0.0:${PORT}  base=${BASE || '/'}`);
});
