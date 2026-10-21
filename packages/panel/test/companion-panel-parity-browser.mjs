// Real-browser geometry probe of shared source components, not installed-host acceptance.
import { createServer } from 'node:http'
const { register } = await import('tsx/esm/api')
register()
const React = await import('react')
globalThis.React = React
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: FooterButtons } = await import('../src/client/ported/design/FooterButtons.tsx')
const { DOCK_CSS } = await import('../src/client/styles.ts')
const footer = renderToStaticMarkup(React.createElement(FooterButtons, {
  disabled: true, regenerateText: '撤回操作', saveText: '保存并评估下一步',
}))
const html = `<!doctype html><meta charset="utf-8"><title>Shared Panel layout verification</title>
<style>${DOCK_CSS}
body{font:14px system-ui;margin:20px}.probe{position:relative;width:var(--width);border:1px solid #ddd;margin:20px 0}
.dsh-design-dock{position:relative;width:100%;box-sizing:border-box}
button{font:inherit;padding:6px 16px;border:1px solid #ddd;border-radius:6px}
.dsh-design-workspace-inset{padding:16px 0 16px 16px}
</style><h1>Yugoo design — shared Panel layout probe</h1>
${[320,480,900].map(width => `<section class="probe" data-width="${width}" style="--width:${width}px"><div class="dsh-design-dock">${footer}<div class="dsh-design-workspace-inset"><div class="dsh-design-dock-panel-body">普通表单 · 单层留白</div><div class="dsh-design-dock-panel-body dsh-design-dock-panel-workspace">工作区 · 保留原留白</div></div></div></section>`).join('')}`
const server = createServer((request, response) => {
  if (request.url !== '/') { response.writeHead(404); response.end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(html)
})
server.listen(0, '0.0.0.0', () => console.log(JSON.stringify({ pid: process.pid, port: server.address().port })))
process.once('SIGTERM', () => server.close(() => process.exit(0)))
