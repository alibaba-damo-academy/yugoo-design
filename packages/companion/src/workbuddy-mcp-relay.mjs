/** Experimental external-input bridge. Own loopback server; no model or project IO. */
import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export function createRelayQueue({ now = Date.now, freshMs = 15000, deadlineMs = 30000, terminalLimit = 32 } = {}) {
  let owner, generation = 0, onlineAt = -Infinity, visible = false, closed = false, current
  const jobs = new Map()
  // Bounded tombstones never forget a submitted ID during this service's
  // lifetime. A Bloom false positive rejects a new ID conservatively; it can
  // never replay an evicted receipt. Full message bodies retain only N terminals.
  const seen = new Uint8Array(32768)
  const positions = id => { const hash = createHash('sha256').update(id).digest(); return [0, 4, 8, 12].map(offset => hash.readUInt32LE(offset) % (seen.length * 8)) }
  const seenBefore = id => positions(id).every(bit => seen[bit >> 3] & (1 << (bit & 7)))
  const remember = id => positions(id).forEach(bit => { seen[bit >> 3] |= 1 << (bit & 7) })
  const prune = () => {
    const terminal = [...jobs.values()].filter(job => job !== current && ['submitted_unverified', 'not_delivered'].includes(job.status))
    for (const job of terminal.slice(0, Math.max(0, terminal.length - terminalLimit))) jobs.delete(job.id)
  }
  const expire = () => { if (current && now() >= current.deadline && ['queued', 'claimed'].includes(current.status)) current.status = current.status === 'queued' ? 'not_delivered' : 'delivery_unknown' }
  const snapshot = job => job ? { id: job.id, status: job.status } : undefined
  const available = () => !closed && visible && now() - onlineAt < freshMs
  return {
    pulse(clientId, isVisible, lease) {
      if (closed || !/^[a-f0-9-]{36}$/.test(clientId)) throw Error('Relay is closed or client identity is invalid.')
      if (lease !== undefined && (lease !== generation || clientId !== owner)) throw Error('Stale widget generation. Reopen it from the original conversation.')
      if (owner && owner !== clientId && now() - onlineAt < freshMs) throw Error('Another widget owns this relay. Wait for its lease to expire, then reconnect from the original conversation.')
      if (owner !== clientId) {
        if (current?.status === 'claimed') current.status = 'delivery_unknown'
        owner = clientId; generation++
      }
      owner = clientId; onlineAt = now(); visible = isVisible === true
      return { online: available(), generation }
    },
    release(clientId, lease) {
      if (closed || clientId !== owner || lease !== generation) throw Error('Stale widget generation.')
      if (current?.status === 'claimed') current.status = 'delivery_unknown'
      owner = undefined; generation++; onlineAt = -Infinity; visible = false
      return { online: false }
    },
    submit(id, text) {
      expire()
      if (!/^[a-f0-9-]{36}$/.test(id) || typeof text !== 'string' || !text.trim() || text.length > 16000) throw Error('Invalid message.')
      if (jobs.has(id)) {
        if (jobs.get(id).text !== text) throw Error('Message ID reused with different content.')
        return snapshot(jobs.get(id))
      }
      if (seenBefore(id)) throw Error('消息回执已过保留期；不会再次投递，请核对原会话。')
      if (!available()) throw Error('请回到原 WorkBuddy 对话，保持连接控件打开；当前未发送。')
      if (current && ['queued', 'claimed', 'delivery_unknown'].includes(current.status)) throw Error('前一条消息尚未确认，请检查原会话；不会自动重发。')
      remember(id)
      current = { id, text, status: 'queued', deadline: now() + deadlineMs }; jobs.set(id, current); prune()
      return snapshot(current)
    },
    take(clientId, lease) {
      expire()
      if (clientId !== owner || (lease !== undefined && lease !== generation) || !available()) throw Error('Original widget is not ready.')
      // Keep this queue quarantined, but expose the existing explicit reopen
      // path. A new owned service can accept new events, never replay this one.
      if (current?.status === 'delivery_unknown') return { message: null, requiresNewService: true }
      if (!current || current.status !== 'queued') return { message: null }
      current.status = 'claimed'; current.claimant = clientId; current.claimGeneration = generation
      return { message: { id: current.id, text: current.text } }
    },
    settle(clientId, id, status, lease) {
      expire()
      if (closed || clientId !== owner || (lease !== undefined && lease !== generation) || current?.id !== id || current.claimant !== clientId || current.claimGeneration !== generation || !['claimed', 'delivery_unknown'].includes(current.status)) throw Error('Stale delivery result.')
      if (!['submitted_unverified', 'delivery_unknown'].includes(status)) throw Error('Invalid delivery status.')
      current.status = status
      return snapshot(current)
    },
    status(id) { expire(); return { online: available(), ...(id ? { message: snapshot(jobs.get(id)) } : {}), retainedReceipts: jobs.size } },
    close() { closed = true; visible = false; if (current?.status === 'queued') current.status = 'not_delivered'; else if (current?.status === 'claimed') current.status = 'delivery_unknown' },
  }
}

const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkBuddy 外部输入测试</title>
<style>body{font:15px system-ui;max-width:640px;margin:40px auto;padding:0 20px}textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px}button{margin-top:12px;padding:8px 16px}p{line-height:1.6}</style>
<h2>WorkBuddy 外部输入测试</h2><p>此页只测试消息传输，不创建或保存 Design Project。请保持原 WorkBuddy 会话中的连接控件打开。</p>
<textarea id="text" rows="4" aria-label="发送到原 WorkBuddy 会话">这是外部浏览器消息通道测试。请只回复 YUGOO_WORKBUDDY_EXTERNAL_ACK，不调用工具，不修改文件。</textarea><br><button id="send">发送到原 WorkBuddy 会话</button><p id="status" role="status">正在检查连接…</p>
<script>
const token=location.hash.slice(1),button=document.getElementById('send'),status=document.getElementById('status');let busy=false;
async function api(body){const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':token},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
api({action:'status'}).then(v=>{status.textContent=v.online?'连接在线，可以发送。':'连接离线，请回到原 WorkBuddy 会话启用控件。';}).catch(e=>{status.textContent=e.message;button.disabled=true;});
button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;const id=crypto.randomUUID();let submitted=false;
try{await api({action:'send',id,text:document.getElementById('text').value});submitted=true;status.textContent='等待原会话接口回执…';
for(let n=0;n<20;n++){await new Promise(r=>setTimeout(r,1000));const v=await api({action:'status',id});const s=v.message?.status;
if(s==='submitted_unverified'){status.textContent='宿主接口已返回，请在原 WorkBuddy 对话确认消息和回复。此状态不代表模型已回复。';return;}
if(s==='delivery_unknown')throw Error('发送结果不确定，请检查原会话，不要重复发送。');if(s==='not_delivered')throw Error('消息未交给宿主，请回到原会话检查连接。');}
throw Error('等待超时，请检查原会话，不要重复发送。');
}catch(e){status.textContent=e.message;if(!submitted){button.disabled=false;busy=false;}}};
</script></html>`

export async function startWorkBuddyRelay({ idleTimeoutMs = 0, maxLifetimeMs = 0, getLastActivityAt, onClose } = {}) {
  const browserToken = randomBytes(32).toString('hex'), widgetToken = randomBytes(32).toString('hex')
  const queue = createRelayQueue()
  let origin, expiryTimer, closing
  const startedAt = Date.now(); let lastPulseAt = startedAt
  const close = (reason = 'explicit-close') => closing ??= (async () => {
    clearInterval(expiryTimer); queue.close(); server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await onClose?.({ reason, startedAt, lastPulseAt, closedAt: Date.now() })
  })()
  const equal = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b))
  const server = createServer(async (request,response) => {
    const bridge = request.url === '/bridge'
    const headers = { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff', ...(bridge ? { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Relay-Token' } : {}) }
    const send = (code,body) => { response.writeHead(code,headers);response.end(JSON.stringify(body)) }
    try {
      if(request.headers.host!==new URL(origin).host)return send(403,{error:'Invalid local Host.'})
      if(request.method==='GET'&&request.url==='/') { response.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer'});response.end(page);return }
      if(bridge&&request.method==='OPTIONS')return send(204,{})
      if(request.method!=='POST'||!['/api','/bridge'].includes(request.url))return send(404,{error:'Not found.'})
      // Widget has an opaque sandbox Origin. A distinct high-entropy credential gates
      // its narrowly scoped bridge endpoint; browser composer still requires same Origin.
      if(!equal(request.headers['x-relay-token'],bridge?widgetToken:browserToken)||(!bridge&&request.headers.origin!==origin))return send(403,{error:'Unauthorized relay request.'})
      if(!request.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON required.'})
      let bytes=0,chunks=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>70000)return send(413,{error:'Message too large.'});chunks.push(chunk)}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      let result
      if(bridge&&body.action==='pulse'){result=queue.pulse(body.clientId,body.visible,body.generation);lastPulseAt=Date.now()}
      else if(bridge&&body.action==='release')result=queue.release(body.clientId,body.generation)
      else if(bridge&&body.action==='take')result=queue.take(body.clientId,body.generation)
      else if(bridge&&body.action==='result')result=queue.settle(body.clientId,body.id,body.status,body.generation)
      else if(!bridge&&body.action==='status')result=queue.status(body.id)
      else if(!bridge&&body.action==='send')result=queue.submit(body.id,body.text)
      else return send(400,{error:'Unknown action.'})
      send(200,result)
    }catch(error){send(400,{error:error instanceof SyntaxError?'Invalid JSON.':error.message})}
  })
  server.requestTimeout=20000
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  origin=`http://127.0.0.1:${server.address().port}`
  if (idleTimeoutMs || maxLifetimeMs) expiryTimer = setInterval(() => {
    const now = Date.now()
    const activity = getLastActivityAt?.()
    const lastActivityAt = Math.max(lastPulseAt, Number.isFinite(activity) ? activity : 0)
    if (maxLifetimeMs && now-startedAt >= maxLifetimeMs) void close('maximum-lifetime')
    else if (idleTimeoutMs && now-lastActivityAt >= idleTimeoutMs) void close('idle-timeout')
  }, Math.min(1000, idleTimeoutMs || maxLifetimeMs)).unref()
  return {origin,widgetToken,browserToken,url:`${origin}/#${browserToken}`,queue,
    close }
}
