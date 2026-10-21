/** Read-only committed Design Files, isolated HTML; no database/project writes. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { projectDesignGraph } = await import('../../core/src/design-graph.ts')
const { parseSchemaYaml } = await import('../../core/src/schema.ts')
const { parse } = await import('../../../packages/core/node_modules/yaml/dist/index.js')
const [root, buildDir, port = '40169'] = process.argv.slice(2)
if (!root || !buildDir) throw new Error('Usage: serve-graph-source-preview.mjs PROJECT BUILD_DIR [PORT]')
const kit = resolve(import.meta.dirname, '../../skills-web-app')
const git = args => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'})
const checkpoint = git(['rev-parse','HEAD']).trim(), files = {}, schemas = {}, panels = {}
for (const p of git(['ls-tree','-r','--name-only',checkpoint,'--','design_files']).trim().split('\n')) {
  const rel = p.replace(/^design_files\//,''), parts = rel.split('/')
  if (parts.length !== 2 || parts[1] !== parts[0] + '.json') continue
  files[rel] = JSON.parse(git(['show',checkpoint + ':' + p]))
  try { schemas[rel] = parseSchemaYaml(await readFile(join(kit,'bundles',parts[0],'schema.yaml'),'utf8')) }
  catch(e) { if (e.code !== 'ENOENT') throw e }
  try {
    const manifest = parse(await readFile(join(kit,'bundles',parts[0],'skill.yaml'),'utf8'))
    if (manifest.name === parts[0] && typeof manifest.title?.zh === 'string') panels[rel] = manifest.title.zh
  } catch(e) { if (e.code !== 'ENOENT') throw e }
}
const graph = projectDesignGraph(files,checkpoint,schemas,{purpose:'storage'})
for (const node of graph.nodes) if (panels[node.file]) node.previewSourcePanel = panels[node.file]
graph.warnings.push('只读来源展示试验：面板名称取现有 manifest 标题；仅已提交文件投影，不含数据库 Embedding/GRA 关系。')
const css = `.preview-node-source{margin:14px 0;padding:14px;background:#f6f8fc;border:1px solid #e4e9f1;border-radius:10px;overflow-wrap:anywhere}.preview-source-heading{font-size:10px;color:#7a8494;letter-spacing:.12em;margin-bottom:10px}.preview-source-panel{display:flex;align-items:center;gap:10px;margin-bottom:12px}.preview-source-panel strong{font-size:13px;color:#485a77}.preview-node-source dl{margin:0}.preview-node-source dt{font-size:10px;color:#7a8494;margin-top:10px}.preview-node-source dd{font-family:ui-monospace,monospace;font-size:11px;line-height:1.6;margin:3px 0 0;color:#42536e}.preview-node-source>small{display:block;font-size:10px;color:#8c94a1;margin-top:12px}.preview-source-panel small{font-size:10px;color:#7a8494}`
const server = createServer(async(req,res) => {
  try {
    res.setHeader('Cache-Control','no-store')
    if (req.url === '/graph.json') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(graph));return}
    if (/^\/[\w.-]+\.js$/.test(req.url)) {res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(buildDir,req.url.slice(1))));return}
    res.setHeader('Content-Type','text/html; charset=utf-8')
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KAG · 节点来源试验</title><style>html,body,#root{height:100%;margin:0;font-family:system-ui}' + css + '</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
  } catch(e) {res.statusCode=500;res.end(String(e.message))}
})
server.listen(Number(port),'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/?real`,checkpoint,nodes:graph.nodes.length,edges:graph.edges.length,panels})))
