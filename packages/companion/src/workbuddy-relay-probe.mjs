/** Stdio MCP App bridge to an isolated external input test page. */
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { startDetachedWorkBuddyRelay } from './workbuddy-relay-service.mjs'

const uri='ui://yugoo-workbuddy-relay-probe/connect'
export function relayWidget(relay) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px/1.5 system-ui;margin:8px;color-scheme:light dark;background:Canvas;color:CanvasText}.connection-card{border:1px solid var(--ds-border,color-mix(in srgb,CanvasText 22%,Canvas));border-radius:var(--ds-radius-4,8px);padding:16px;overflow-wrap:anywhere}h3{font-size:16px;font-weight:500;margin:0 0 8px}p{margin:8px 0 12px}button{font:inherit;min-height:36px;padding:6px 12px;border:1px solid var(--ds-border,ButtonBorder);border-radius:var(--ds-radius-4,8px);background:var(--ds-bg-panel,ButtonFace);color:ButtonText;cursor:pointer}button:disabled{cursor:default;opacity:.65}button:focus-visible,summary:focus-visible{outline:2px solid var(--ygd-panel-control-focus,Highlight);outline-offset:2px}details{margin-top:12px;font-size:12px}summary{cursor:pointer}input{display:block;width:100%;box-sizing:border-box;font:inherit}#status{margin-bottom:0}#secondary-actions{margin-top:8px}</style>
<section class="connection-card" aria-labelledby="connection-title"><h3 id="connection-title">${relay.dynamic ? "设计面板" : "WorkBuddy 外部输入连接测试"}</h3><p id="description">${relay.dynamic ? (relay.autoConnect ? "正在准备面板并连接当前对话…" : "连接后，点击面板中的「保存并继续」即可回到本对话继续设计。") : "启用后，外部测试页的消息通过此控件发送到当前会话。请保持原会话和控件打开。测试连接空闲 5 分钟或运行 15 分钟后关闭；失效后重新调用测试工具。不创建或保存设计项目。"}</p>
<div id="primary-actions"><button id="connect" disabled${relay.dynamic && relay.autoConnect ? ' hidden' : ''}>${relay.dynamic ? (relay.autoConnect ? "在系统浏览器打开" : "连接当前对话") : "连接并打开外部输入页"}</button></div>
${relay.dynamic ? '<details id="open-options" hidden><summary>其他打开方式</summary><div id="secondary-actions"></div></details>' : ''}
<p id="status" role="status">正在连接宿主…</p>
${relay.dynamic ? '<details><summary>连接帮助</summary><p>请保持当前对话和此控件打开。连接中断不影响已保存文件；恢复连接后可继续。控件与面板均空闲 15 分钟，或运行 4 小时后，连接将关闭。</p><div id="design-browser-guide" hidden><p>需要在右侧浏览器打开页面时，复制地址，在新标签页中选择「打开浏览器」并粘贴。</p><button id="copy-design-url" disabled>复制页面地址</button><label id="manual-copy" hidden>页面地址<input id="design-url" type="text" readonly></label></div></details>' : ''}
</section>
<script>
let origin=${JSON.stringify(relay.origin)}, token=${JSON.stringify(relay.widgetToken)}, url=${JSON.stringify(relay.url)};const dynamicMode=${relay.dynamic === true};let hostReady=false;const autoConnectMode=dynamicMode&&${relay.autoConnect === true};let autoConnectAttempted=false;
let panelView='full';const description=dynamicMode?document.getElementById('description'):null;
const copyButton=dynamicMode?document.getElementById('copy-design-url'):null,designGuide=dynamicMode?document.getElementById('design-browser-guide'):null,manualCopy=dynamicMode?document.getElementById('manual-copy'):null,designUrlInput=dynamicMode?document.getElementById('design-url'):null;
const button=document.getElementById('connect'),status=document.getElementById('status'),clientId=crypto.randomUUID();let id=0,hostOrigin,active=false,reopenArgs,projectId,threadId,connectionPath,needsReopen=false,reopenUnknown=false,connectionInvalidated=false,pageDisposed=false,copyGeneration=0,transportGeneration=0,connectPending=false;
const primaryActions=dynamicMode?document.getElementById('primary-actions'):null,secondaryActions=dynamicMode?document.getElementById('secondary-actions'):null,openOptions=dynamicMode?document.getElementById('open-options'):null;
const pending=new Map();let leaseGeneration,pollTimer,heartbeatTimer;
function hostError(error){
const candidates=[error?.message,error?.message?.message,error?.data?.message];
const text=candidates.find(value=>typeof value==='string'&&value.trim()&&value.trim()!=='[object Object]');
return Error(text?text.slice(0,500):'WorkBuddy 请求失败，宿主未提供可读原因（WB_HOST_RPC_FAILED）。请在原对话请求重新打开现有项目面板。');
}
function request(method,params,timeoutMs=10000){return new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('宿主响应超时，停止转发，请检查原会话。'));},timeoutMs);pending.set(key,{resolve,reject,timer,method});parent.postMessage({jsonrpc:'2.0',id:key,method,params},hostOrigin||'*');});}
function localUrl(value){try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port&&u.pathname==='/'&&!u.username&&!u.password;}catch{return false;}}
// Every asynchronous continuation belongs to one transport lifetime. A later
// explicit reconnect cannot revive old requests or scheduled polling callbacks.
function transportCurrent(generation){return generation===transportGeneration&&!connectionInvalidated&&!pageDisposed;}
function stopTransport(){transportGeneration++;active=false;connectPending=false;clearTimeout(pollTimer);clearTimeout(heartbeatTimer);pollTimer=heartbeatTimer=undefined;for(const [key,item] of pending){if(item.method==='ui/initialize')continue;clearTimeout(item.timer);pending.delete(key);item.reject(Error('连接生命周期已结束；未确认的消息不会重发。'));}}
function validConnection(cfg){if(!cfg||!localUrl(cfg.origin)||!/^[a-f0-9]{64}$/.test(cfg.widgetToken))return false;try{const u=new URL(cfg.url);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port&&!u.username&&!u.password&&((u.pathname==='/'&&/^#[a-f0-9]{64}$/.test(u.hash))||(/^\\/browser\\/[a-f0-9]{32}\\/$/.test(u.pathname)&&!u.hash));}catch{return false;}}
function connectionUrl(value){const u=new URL(value);u.searchParams.delete('view');return u.href;}
function sameConnection(cfg){return cfg.origin===origin&&cfg.widgetToken===token&&connectionUrl(cfg.url)===connectionUrl(url)&&cfg.projectId===projectId&&cfg.threadId===threadId&&cfg.connectionPath===connectionPath;}
function clearCopiedAddress(){copyGeneration++;if(manualCopy)manualCopy.hidden=true;if(designUrlInput)designUrlInput.value='';}
function updateViewControls(){
if(!dynamicMode)return;const design=panelView==='panel-only';
// The host renders this card before invoking native navigation. Keep the
// optional external window secondary from first paint, without delaying relay
// readiness or claiming that a navigation request has visibly opened the page.
const secondary=autoConnectMode&&design&&!needsReopen;
const actions=secondary?secondaryActions:primaryActions;
if(button.parentNode!==actions)actions.appendChild(button);
button.hidden=autoConnectMode&&!origin;
openOptions.hidden=!secondary||!origin;
if(openOptions.hidden)openOptions.open=false;
button.textContent=connectPending?'正在连接…':needsReopen?'恢复设计面板':autoConnectMode?'在系统浏览器打开':design?(active?'已连接当前对话':'连接当前对话'):'打开设计面板';
button.disabled=!hostReady||!origin||connectPending||reopenUnknown||connectionInvalidated||pageDisposed||(!autoConnectMode&&design&&active);
copyButton.hidden=!design;copyButton.disabled=!hostReady||!url||needsReopen||reopenUnknown||connectionInvalidated||pageDisposed;designGuide.hidden=!design;
description.textContent=autoConnectMode?(design?'WorkBuddy 会自动打开面板，无需在这里操作。':'在系统浏览器中打开完整工作区，保存后可回到本对话继续。'):design?'连接后，点击面板中的「保存并继续」即可回到本对话继续设计。':'在独立浏览器中查看和编辑设计，保存后可回到本对话继续。';
if(needsReopen)description.textContent='面板连接已中断，请恢复连接。已保存文件不受影响。';
if(!design)clearCopiedAddress();
}
if(copyButton)copyButton.onclick=async()=>{
if(copyButton.disabled||connectionInvalidated||pageDisposed)return;const originalUrl=url,page=new URL(url);page.searchParams.set('view','panel-only');clearCopiedAddress();const generation=copyGeneration;const current=()=>generation===copyGeneration&&url===originalUrl&&panelView==='panel-only'&&!connectionInvalidated&&!pageDisposed&&!needsReopen&&!reopenUnknown;
try{if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(page.href);if(!current())return;status.textContent='已复制设计视图地址。请在右侧新标签页选择「打开浏览器」，粘贴到地址栏。'+(active?'已连接当前对话。':autoConnectMode?'正在连接当前对话，请留意连接状态。':'还需点击「连接当前对话」。');}
catch{if(!current())return;designUrlInput.value=page.href;manualCopy.hidden=false;designUrlInput.focus();designUrlInput.select();status.textContent='宿主未允许自动复制。请按 Ctrl+C 复制已选中的地址，再粘贴到内嵌浏览器地址栏。'+(active?'已连接当前对话。':autoConnectMode?'正在连接当前对话，请留意连接状态。':'还需点击「连接当前对话」。');}
};
function applyConnection(cfg,recovery=false){
if(!validConnection(cfg))return false;
if(recovery&&(cfg.projectId!==projectId||cfg.threadId!==threadId||typeof cfg.connectionPath!=='string'||!cfg.connectionPath))return false;
const args=cfg.reopenArgs;
if(args&&['projectRoot','sessionId','nativeCwd','transcriptPath'].every(key=>typeof args[key]==='string'&&args[key])&&args.sessionId===cfg.threadId){
if(recovery&&Object.keys(reopenArgs).some(key=>args[key]!==reopenArgs[key]))return false;
reopenArgs={projectRoot:args.projectRoot,sessionId:args.sessionId,nativeCwd:args.nativeCwd,transcriptPath:args.transcriptPath,...(['full','panel-only','design'].includes(args.view)?{view:args.view}:{})};
}else if(recovery)return false;
if(!origin||!sameConnection(cfg)){stopTransport();leaseGeneration=undefined;autoConnectAttempted=false;}
panelView=['design','panel-only'].includes(cfg.view)?'panel-only':'full';
origin=cfg.origin;token=cfg.widgetToken;url=cfg.url;projectId=cfg.projectId;threadId=cfg.threadId;connectionPath=cfg.connectionPath;needsReopen=false;clearCopiedAddress();updateViewControls();return true;
}
window.addEventListener('message',e=>{if(e.source!==parent||(hostOrigin&&e.origin!==hostOrigin))return;const m=e.data;if(m?.jsonrpc!=='2.0')return;if(dynamicMode&&m.method==='ui/notifications/tool-result'){
const cfg=m.params?._meta?.workbuddyPanel;if(!validConnection(cfg))return;
if((active||connectPending)&&!sameConnection(cfg)){connectionInvalidated=true;stopTransport();clearCopiedAddress();updateViewControls();status.textContent='项目连接已变更，请重新打开本次连接控件。';return;}
if(!reopenUnknown&&!connectionInvalidated&&!pageDisposed&&applyConnection(cfg)){status.textContent=active?'已连接当前对话，面板可直接使用。':'项目：'+cfg.projectName;autoConnect();}return;
}const p=pending.get(m.id);if(!p||(!('result'in m)&&!m.error))return;hostOrigin=e.origin==='null'?undefined:e.origin;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(hostError(m.error)):p.resolve(m.result);});
let bridgePolicyBlocked=false;
window.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective==='connect-src'){try{if(new URL(e.blockedURI).origin===origin)bridgePolicyBlocked=true;}catch{}}});
async function bridge(body){let r;bridgePolicyBlocked=false;try{r=await fetch(origin+'/bridge',{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':token},body:JSON.stringify({clientId,generation:leaseGeneration,...body}),signal:AbortSignal.timeout(5000)});}catch(e){
if(bridgePolicyBlocked)throw Error('宿主安全策略阻止了本地连接（WB_BRIDGE_POLICY）。请报告此错误，不要关闭宿主安全设置。已保存文件不受影响。');
const code=e.name==='TimeoutError'?'WB_BRIDGE_TIMEOUT':'WB_BRIDGE_NETWORK';
const error=Error('本地连接请求未完成（'+code+'）。可点击按钮恢复连接；不要重跑设计任务。已保存文件不受影响。');error.bridgeUnavailable=true;throw error;
}let v;try{v=await r.json();}catch{throw Error('本地连接响应无效（WB_BRIDGE_RESPONSE）。请报告此错误。已保存文件不受影响。');}if(!r.ok)throw Error(v.error||'本地连接拒绝了请求（HTTP '+r.status+'）。');return v;}
// Viewport visibility is not native session identity. The host owns the original
// MCP App route; page disposal and missed heartbeats still revoke availability.
window.addEventListener('pagehide',()=>{
if(active&&leaseGeneration!==undefined)void fetch(origin+'/bridge',{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':token},body:JSON.stringify({clientId,generation:leaseGeneration,action:'release'}),keepalive:true}).catch(()=>{});
pageDisposed=true;stopTransport();button.disabled=true;clearCopiedAddress();updateViewControls();});
window.addEventListener('pageshow',e=>{if(!e.persisted||connectionInvalidated||reopenUnknown)return;pageDisposed=false;leaseGeneration=undefined;autoConnectAttempted=false;updateViewControls();autoConnect();});
function enableRecovery(error){needsReopen=dynamicMode&&!!reopenArgs&&(error.bridgeUnavailable===true||error.requiresNewService===true);button.disabled=reopenUnknown;clearCopiedAddress();updateViewControls();if(!dynamicMode)button.textContent='连接并打开外部输入页';}
// Renewal must not wait behind take, ui/message or result RPC. Each loop has
// one in-flight request and is fenced by the same transport generation.
async function heartbeat(generation){
const current=()=>active&&transportCurrent(generation);if(!current())return;
try{const lease=await bridge({action:'pulse',visible:true});if(!current())return;leaseGeneration=lease.generation;}
catch(e){if(!current())return;stopTransport();enableRecovery(e);status.textContent='连接已停止：'+e.message+' 已保存文件不受影响；恢复不会重发之前的消息。';}
if(current())heartbeatTimer=setTimeout(()=>heartbeat(generation),1000);
}
async function poll(generation){
const current=()=>active&&transportCurrent(generation);if(!current())return;
try{
const {message,requiresNewService}=await bridge({action:'take'});if(!current())return;
if(requiresNewService)throw Object.assign(Error('前一条消息结果未知，请先核对原会话。恢复连接仅允许新的操作继续，不会重发旧消息。'),{requiresNewService:true});
if(message){
let outcome='delivery_unknown',deliveryError;
try{const receipt=await request('ui/message',{role:'user',content:[{type:'text',text:message.text}]});if(!current())return;if(receipt?.isError)throw Error('宿主拒绝了消息，请检查原会话。');outcome='submitted_unverified';}
catch(e){if(!current())return;deliveryError=e;}
// A dispatched host message cannot be withdrawn. If disposed while awaiting its
// receipt, leave delivery unknown; do not acknowledge success or resend it.
await bridge({action:'result',id:message.id,status:outcome});if(!current())return;
if(deliveryError)throw Object.assign(deliveryError,{requiresNewService:true});
status.textContent='宿主消息接口已返回；请在原对话确认回复，此回执不代表 Agent 已消费或完成。';
}
}catch(e){if(!current())return;stopTransport();enableRecovery(e);status.textContent='连接已停止：'+e.message+' 若刚发送过消息，请先核对原会话；重开不会重发。';}
if(current())pollTimer=setTimeout(()=>poll(generation),1000);
}
async function connect(openExternal=false){if(!hostReady||connectPending||reopenUnknown||connectionInvalidated||pageDisposed||(dynamicMode&&(!origin||(!autoConnectMode&&panelView==='panel-only'&&active))))return;if(!active)stopTransport();const generation=transportGeneration;connectPending=true;button.disabled=true;updateViewControls();try{
if(needsReopen){
reopenUnknown=true;status.textContent='正在向原 WorkBuddy 对话发送重开请求…';
const text='请仅恢复当前设计面板连接：核对下列项目和会话信息与当前原生 Hook 身份一致后，调用 yugoo_workbuddy_open_panel 一次。原项目和会话参数：'+JSON.stringify(reopenArgs)+
'。不要新建项目、运行 Bundle、启动子代理、修改设计文件或重发之前的消息。返回新连接控件及精确 connection 路径后停止，新控件会自动连接；若已有本次恢复调用的成功结果则复用，不重复启动。';
const receipt=await request('ui/message',{role:'user',content:[{type:'text',text}]});
if(!transportCurrent(generation))return;connectPending=false;
if(receipt?.isError){reopenUnknown=false;needsReopen=true;button.disabled=false;button.textContent='恢复设计面板';status.textContent='宿主拒绝了重开请求，未确认发送。请回到原对话处理。';return;}
button.disabled=true;status.textContent='重开请求已交给原 WorkBuddy 对话，尚未确认新面板启动。请查看回复中的新连接控件；此处不会重复发送。';return;
}
const lease=await bridge({action:'pulse',visible:true});if(!transportCurrent(generation))return;leaseGeneration=lease.generation;
if(!active){active=true;void heartbeat(generation);void poll(generation);}
if(!transportCurrent(generation))return;
const pageUrl=new URL(url);if(dynamicMode){if(panelView==='panel-only')pageUrl.searchParams.set('view','panel-only');else pageUrl.searchParams.delete('view');if(reopenArgs)reopenArgs.view=panelView;}
if(autoConnectMode)pageUrl.searchParams.delete('view');
if(autoConnectMode?openExternal:!(dynamicMode&&panelView==='panel-only')){
try{const opened=await request('ui/open-link',{url:pageUrl.href});if(!transportCurrent(generation))return;if(opened?.isError)throw Error('宿主未打开外部页面。');}
catch(error){if(!transportCurrent(generation))return;if(!autoConnectMode)throw error;connectPending=false;updateViewControls();status.textContent='已连接当前对话。系统浏览器打开未确认，请检查浏览器；面板保存仍可回传，不会自动重试打开。';return;}
}
if(!transportCurrent(generation))return;connectPending=false;updateViewControls();if(!dynamicMode)button.disabled=false;status.textContent=autoConnectMode?'已连接当前对话，面板可直接使用。':dynamicMode?'请保持当前对话和此控件打开。':'外部连接已启用，请到浏览器测试页发送消息。';
}catch(e){if(!transportCurrent(generation))return;stopTransport();enableRecovery(e);status.textContent='连接失败：'+e.message+(reopenUnknown?' 重开请求是否送达尚未确认，请回到原对话核对；不会自动重发或启动。':'');}}
button.onclick=()=>connect(true);
function autoConnect(){if(!autoConnectMode||autoConnectAttempted||!hostReady||!origin||active||connectPending||needsReopen||reopenUnknown||connectionInvalidated||pageDisposed)return;autoConnectAttempted=true;void connect(false);}
(async()=>{try{const r=await request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'yugoo-workbuddy-relay-probe',version:'0.1.0'},appCapabilities:{}});if(pageDisposed||connectionInvalidated)return;if(!r?.hostCapabilities?.message||!r.hostCapabilities.openLinks)throw Error('宿主未声明消息或打开链接能力。');parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},hostOrigin||'*');hostReady=true;button.disabled=dynamicMode&&!origin;updateViewControls();status.textContent=button.disabled?'等待本次项目连接信息…':autoConnectMode?'正在连接当前对话…':'点击按钮连接当前对话。';autoConnect();}catch(e){if(!pageDisposed&&!connectionInvalidated)status.textContent=e.message;}})();
</script></html>`
}

export function createRelayProbe({ startRelay = startDetachedWorkBuddyRelay } = {}) {
  let relayPromise
  const ensure=()=>relayPromise??=startRelay()
  return {
    async handle({id,method,params={}}) {
      if(id===undefined)return
      const ok=result=>({jsonrpc:'2.0',id,result}),bad=(code,message)=>({jsonrpc:'2.0',id,error:{code,message}})
      const meta={ui:{resourceUri:uri}}
      if(method==='initialize')return ok({protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'yugoo-workbuddy-relay-probe',version:'0.1.0'}})
      if(method==='ping')return ok({})
      if(method==='tools/list')return ok({tools:[{name:'yugoo_workbuddy_relay_probe',description:'Show a user-enabled MCP App bridge to an external browser input test. No project writes or model launch.',inputSchema:{type:'object',properties:{},additionalProperties:false},_meta:meta}]})
      if(method==='resources/list')return ok({resources:[{uri,name:'WorkBuddy external input bridge',mimeType:'text/html;profile=mcp-app'}]})
      if(method==='resources/templates/list')return ok({resourceTemplates:[]})
      if(method==='tools/call'){
        if(params.name!=='yugoo_workbuddy_relay_probe'||Object.keys(params.arguments??{}).length)return bad(-32602,'Unknown tool or arguments.')
        return ok({content:[{type:'text',text:'请点击外部输入连接控件，由用户在浏览器测试页发送消息。不要代替用户发送或回复 ACK，不创建项目。'}],structuredContent:{ready:true},_meta:meta})
      }
      if(method==='resources/read'){
        if(params.uri!==uri)return bad(-32602,'Unknown resource.')
        const relay=await ensure()
        return ok({contents:[{uri,mimeType:'text/html;profile=mcp-app',text:relayWidget(relay),_meta:{ui:{csp:{connectDomains:[relay.origin],resourceDomains:[]}}}}]})
      }
      return bad(-32601,'Method not found.')
    },
    async close({ preserveRelay = false } = {}){if(relayPromise && !preserveRelay)await(await relayPromise).close()},
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const probe=createRelayProbe(),lines=createInterface({input:process.stdin,crlfDelay:Infinity})
  try{for await(const line of lines){if(Buffer.byteLength(line)>65536)break;try{const result=await probe.handle(JSON.parse(line));if(result)console.log(JSON.stringify(result))}catch{console.log(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Probe request failed.'}}))}}}finally{await probe.close({ preserveRelay: true })}
}
