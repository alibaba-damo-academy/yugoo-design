/** Isolated MCP Apps discovery. No files, model clients or host-private APIs. */
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

export const resourceUri = 'ui://yugoo-workbuddy-message-probe/check'
export const probeMessage = '这是用户点击的 YuGoo 原会话消息通道测试。请只回复 YUGOO_WORKBUDDY_MESSAGE_ACK，不调用工具，不修改任何文件。'
export const probeHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>原会话消息测试</title>
<style>body{font:14px system-ui;margin:16px;color:light-dark(#222,#eee);background:light-dark(#fff,#222);color-scheme:light dark}button{padding:8px 12px}p{line-height:1.5}</style>
<h3>WorkBuddy 原会话消息测试</h3>
<p>点击后发送一条测试消息，请 WorkBuddy 只回复 YUGOO_WORKBUDDY_MESSAGE_ACK。不会读写项目。</p>
<button id="send" disabled>发送一次测试消息</button><p id="status" role="status">正在连接宿主…</p>
<script>
const button = document.getElementById('send'), status = document.getElementById('status');
let nextId = 1, hostOrigin, attempted = false;
const pending = new Map();
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('宿主响应超时；不自动重发，请检查原会话。')); }, 10000);
    pending.set(id, { resolve, reject, timer });
    parent.postMessage({jsonrpc:'2.0',id,method,params}, hostOrigin || '*');
  });
}
window.addEventListener('message', event => {
  if (event.source !== parent || (hostOrigin && event.origin !== hostOrigin)) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  const waiting = pending.get(message.id);
  if (!waiting || (!('result' in message) && !message.error)) return;
  // Sandbox origins can be opaque; source must still be the exact parent window.
  hostOrigin = event.origin === 'null' ? undefined : event.origin;
  pending.delete(message.id); clearTimeout(waiting.timer);
  if (message.error) waiting.reject(new Error(message.error.message || '宿主拒绝请求'));
  else waiting.resolve(message.result);
});
button.onclick = async () => {
  if (attempted) return;
  attempted = true; button.disabled = true; status.textContent = '已提交发送请求，正在等待宿主回执…';
  try {
    await request('ui/message', {role:'user',content:[{type:'text',text:${JSON.stringify(probeMessage)}}]});
    status.textContent = '宿主接口已返回；请在原会话确认用户消息和 ACK。此回执不代表模型已回复。';
  } catch (error) { status.textContent = error.message; }
};
(async () => {
  try {
    const result = await request('ui/initialize', {protocolVersion:'2026-01-26',appInfo:{name:'yugoo-workbuddy-message-probe',version:'0.1.0'},appCapabilities:{}});
    if (!result?.hostCapabilities?.message) throw new Error('宿主未声明 ui/message 能力，测试已停止。');
    parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},hostOrigin || '*');
    status.textContent = '已连接宿主，点击按钮发送一次测试消息。'; button.disabled = false;
  } catch (error) { status.textContent = error.message; }
})();
</script></html>`

const tool = {
  name: 'yugoo_workbuddy_message_probe',
  description: 'Open a user-clicked MCP App to test one message to the current WorkBuddy conversation. Does not send on tool invocation.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { resourceUri } },
}
export function handleProbeRequest(request) {
  const { id, method, params = {} } = request
  if (id === undefined) return undefined
  const ok = result => ({ jsonrpc: '2.0', id, result })
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
  if (method === 'initialize') return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'yugoo-workbuddy-message-probe', version: '0.1.0' } })
  if (method === 'ping') return ok({})
  if (method === 'tools/list') return ok({ tools: [tool] })
  if (method === 'resources/list') return ok({ resources: [{ uri: resourceUri, name: 'WorkBuddy message probe', mimeType: 'text/html;profile=mcp-app' }] })
  if (method === 'resources/templates/list') return ok({ resourceTemplates: [] })
  if (method === 'tools/call') {
    if (params.name !== tool.name) return error(-32602, 'Unknown probe tool')
    if (Object.keys(params.arguments ?? {}).length) return error(-32602, 'This probe accepts no arguments')
    return ok({ content: [{ type: 'text', text: '请在消息测试控件中点击一次按钮。工具调用本身未发送消息；不要代替用户回复 ACK。' }], structuredContent: { ready: true }, _meta: { ui: { resourceUri } } })
  }
  if (method === 'resources/read') {
    if (params.uri !== resourceUri) return error(-32602, 'Unknown probe resource')
    return ok({ contents: [{ uri: resourceUri, mimeType: 'text/html;profile=mcp-app', text: probeHtml, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] })
  }
  return error(-32601, 'Method not found')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (Buffer.byteLength(line) > 65536) { console.error('Probe input too large'); process.exitCode = 1; break }
    try { const result = handleProbeRequest(JSON.parse(line)); if (result) console.log(JSON.stringify(result)) }
    catch { console.log(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON request' } })) }
  }
}
