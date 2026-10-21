/** Production question manifest + DslPanel + real schema/file persistence. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, readdir, stat, realpath, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { constants, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, extname, isAbsolute } from 'node:path'
import { DesignFilesStore, GitVersioning, validatorFromSchemaYaml } from '../core/lib/index.js'
import { loadDesignKit } from '../core/lib/kit-loader.js'
import { installedVisualCli } from './installed-visual-cli.mjs'
const run = promisify(execFile), root = import.meta.dirname
const temporary = await mkdtemp(join(tmpdir(), 'web-app-declarative-'))
const out = join(temporary, 'web'), project = join(temporary, 'project')
const session = `web-app-declarative-${process.pid}-${temporary.split('/').at(-1)}`
const allBundles = ['smart_questions', 'quality_acceptance', 'notification_design', 'business_rules',
  'integration_design', 'role_access', 'function_modules', 'web_app_prd_assembly', 'research',
  'flow_design', 'whiteboard', 'design_style', 'business_data']
const expectedBundles = process.env.STYLE_ONLY ? ['design_style']
  : process.env.BUSINESS_ONLY ? ['business_data'] : allBundles
const completedBundles = [], commands = [], cleanupErrors = []
const serverLifecycle = []
const controller = new AbortController()
let deadline, browserAttempted = false, failure, server, canvasRevision = 0, toolPins
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AGENT_BROWSER_')))
async function filePin(path) {
  const fingerprint = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; fingerprint.update(chunk) }
  return { path, bytes, sha256: fingerprint.digest('hex') }
}
async function executable(name) {
  const path = process.env[name]
  assert(path && isAbsolute(path), `${name} must identify an explicit absolute executable`)
  const canonical = await realpath(path)
  assert((await stat(canonical)).isFile(), canonical)
  await access(canonical, constants.X_OK)
  return filePin(canonical)
}
let browserCli, chromium
function listenForServer(server, signal, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.off('error', onError)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error); else resolve()
    }
    const onError = error => finish(error)
    const onAbort = () => finish(signal.reason ?? new Error('Server listen aborted'))
    const timer = setTimeout(() => finish(new Error('Server listen exceeded deadline')), timeoutMs)
    server.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) { onAbort(); return }
    try { server.listen(0, '127.0.0.1', () => finish()) } catch (error) { finish(error) }
  })
}
function closeServerObserved(server, timeoutMs = 5000) {
  return new Promise(resolve => {
    let settled = false, forcedServerClose = false
    const finish = observation => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(observation)
    }
    const timer = setTimeout(() => {
      forcedServerClose = true
      const observation = { forcedServerClose: true, error: 'Server close exceeded deadline' }
      try { server.closeAllConnections() } catch (error) { observation.error += ': ' + String(error) }
      finish(observation)
    }, timeoutMs)
    try {
      server.close(error => finish({ forcedServerClose,
        error: forcedServerClose ? 'Server close exceeded deadline' : error ? String(error) : undefined }))
    } catch (error) { finish({ forcedServerClose: false, error: String(error) }) }
  })
}
const config = join(temporary, 'agent-browser.json')
const screenshots = join(temporary, 'screenshots')
const browser = async (...args) => {
  assert(browserCli && chromium, 'Explicit browser preflight must complete first')
  const closing = args[0] === 'close'
  if (!closing) browserAttempted = true
  const started = Date.now()
  try {
    const result = await run(browserCli.path, ['--config', config, '--session', session,
      '--executable-path', chromium.path, ...args], {
      cwd: temporary, env: environment, timeout: closing ? 10000 : 45000,
      signal: closing ? undefined : controller.signal, maxBuffer: 2e6,
    })
    commands.push({ command: args[0], closing, success: true, elapsedMs: Date.now() - started })
    return result.stdout
  } catch (error) {
    commands.push({ command: args[0], closing, success: false, elapsedMs: Date.now() - started,
      code: error.code, signal: error.signal })
    throw error
  }
}
try {
  for (const name of ['STYLE_ONLY', 'BUSINESS_ONLY']) {
    assert(process.env[name] === undefined || process.env[name] === '1', `${name} must be absent or exactly 1`)
  }
  assert(!(process.env.STYLE_ONLY && process.env.BUSINESS_ONLY), 'Choose at most one diagnostic scope')
  browserCli = await executable('WEB_APP_TEST_AGENT_BROWSER')
  chromium = await executable('WEB_APP_TEST_CHROMIUM')
  toolPins = { browserCli, chromium, node: await filePin(process.execPath) }
  await writeFile(config, '{}\n', { flag: 'wx' })
  await mkdir(screenshots)
  deadline = setTimeout(() => controller.abort(new Error('Web App browser verification exceeded 600 seconds')), 600000)

const source = resolve(root, '../skills-web-app/bundles/smart_questions')
const kit = await loadDesignKit({
  readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
}, resolve(source, '../..'), { sourceId: 'fixture:declarative-browser' })
const panelFor = name => kit.skills.find(skill => skill.name === name).metadata.panelYaml
const panel = panelFor('smart_questions')
const validate = validatorFromSchemaYaml(await readFile(join(source, 'schema.yaml'), 'utf8'))
const bundles = { smart_questions: { panel, validate } }
for (const name of ['quality_acceptance', 'notification_design', 'business_rules', 'integration_design', 'role_access', 'function_modules', 'web_app_prd_assembly', 'research', 'flow_design', 'whiteboard', 'design_style', 'business_data']) {
  const dir = resolve(source, '..', name)
  bundles[name] = { panel: panelFor(name), validate: validatorFromSchemaYaml(await readFile(join(dir, 'schema.yaml'), 'utf8')) }
}
const initial = { questions: {
  const_auth_mode: { prompt: '是否需要注册登录？', kind: 'single', answer: 'anonymous', choices: [{ value: 'anonymous', label: '不需要' }] },
  old: { prompt: '历史问题', kind: 'text', answer: '已有回答', round: 0 },
  scope: { prompt: '这一轮优先解决什么问题？', kind: 'text', answer: '', round: 1 },
  channels: { prompt: '选择使用渠道', kind: 'multiple', answer: '', round: 1, choices: [{ value: 'web', label: '网页' }, { value: 'mobile', label: '移动端' }] },
} }
const execute = ({ argv, cwd, stdinData, env }) => new Promise((done, reject) => {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...environment, ...env }, signal: controller.signal })
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', error => { clearTimeout(timer); reject(error) }); child.on('close', exitCode => { clearTimeout(timer); done({ exitCode, stdout, stderr }) }); child.stdin.end(stdinData)
})
  await mkdir(project)
  const git = new GitVersioning(execute, project); await git.ensureRepo()
  const store = new DesignFilesStore({
    readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error } },
    writeText: writeFile, ensureDir: path => mkdir(path, { recursive: true }),
    readBytes: async path => { try { return await readFile(path) } catch (error) { if (error.code === 'ENOENT') return; throw error } },
    writeBytes: writeFile,
  }, git, project)
  const documentState = { schema_version: 8, title: '研发需求文档', detail_level: 'concise', html_file: 'web_app_prd_assembly/prd.html', ai_provenance: [
    { id: 'AI-001', section_ids: ['scope'], operation: 'completion', description: '临时决策', source_refs: [], assumption: { decision: '单人使用', reason: '演示', impact: '访问范围', decision_owner: '用户' } },
  ] }
  const documentHtml = '<!doctype html><html><head><style>body{font:16px system-ui;padding:24px;color:#222}section{min-height:650px}</style></head><body><section><h2 data-prd-sources="function_modules,user" data-prd-provenance-ids="AI-001">功能范围</h2><p>保留原始文档的可阅读内容。</p></section><section><h2 data-prd-sources="quality_acceptance" data-prd-provenance-ids="">质量验收</h2><p>第二章节内容。</p></section><script>window.parent.__unsafePrdScript=true</script></body></html>'
  await store.write('web_app_prd_assembly', documentState, { validate: bundles.web_app_prd_assembly.validate, artifacts: { 'web_app_prd_assembly/prd.html': documentHtml }, origin: 'panel', settleEvent: async () => {} })
  const researchState = { rounds: {
    old: { round_id: 'old', topic: '已完成的历史调研', stage: 'confirmed', directions: { D1: { direction_id: 'D1', title: '历史资料', research_points: ['保留依据'], findings_file: 'research/old/findings.md' } }, direction_order: ['D1'], conclusion_file: 'research/old/conclusion.html' },
    current: { round_id: 'current', topic: '当前调研计划', stage: 'confirmed', directions: { D1: { direction_id: 'D1', title: '当前资料', research_points: ['核对现有信息'], source_urls: ['https://example.com/evidence'], findings_file: 'research/current/findings.md' } }, direction_order: ['D1'] },
  }, round_order: ['old', 'current'], current_round_id: 'current' }
  const researchArtifacts = { 'research/old/findings.md': '# 历史报告\n\n已保存的证据。', 'research/old/conclusion.html': '<!doctype html><html><body><h1>历史结论</h1><p>独立保留的第一轮结果。</p></body></html>', 'research/current/findings.md': '# 当前报告\n\n**独立的新证据**。\n\n[来源](https://example.com/evidence)' }
  const researchAttempts = [{ invocationId: 'current-run', attemptId: 'child-attempt', skill: 'research', artifactId: 'current/D1', artifactKind: 'research_direction', artifactFile: 'research/current/findings.md', runId: 'child-run', role: 'worker', phase: 'working', sequence: 1, timestamp: 1 }]
  await store.write('research', researchState, { validate: bundles.research.validate, artifacts: researchArtifacts, origin: 'panel', settleEvent: async () => {} })
  const flowXml = await readFile(resolve(root, 'test/fixtures/declarative-flow/P-001.bpmn'), 'utf8')
  const flowOriginal = JSON.parse(await readFile(resolve(root, 'test/fixtures/declarative-flow/flow_design.json'), 'utf8'))
  const flowState = { ...flowOriginal, processes: { 'P-001': flowOriginal.processes['P-001'] }, process_order: ['P-001'] }
  await store.write('flow_design', flowState, { validate: bundles.flow_design.validate, artifacts: { 'flow_design/P-001.bpmn': flowXml }, origin: 'panel', settleEvent: async () => {} })
  const styleState = { skill_name: 'design_style', config: { theme: '已有设计', colors: { primary: '#123456', background: '#ffffff' },
    layout: { mode: 'sidebar', density: 'comfortable', content_width: 'wide', sidebar: null }, typography: { bodyFont: 'Custom Font', privateFont: 'keep' },
    preview_page: { title: '代表性工作台', html_file: 'design_style/preview.html', rationale: '使用真实产物检查配色与文字层级。' },
    notes: '保留设计依据', component_patterns: { custom: { description: '未暴露字段不可丢失' } } } }
  const styleHtml = `<!doctype html><html><head><style>body{margin:0;padding:32px;background:var(--ds-background);font-family:var(--ds-body-font);color:var(--ds-text)}button{padding:12px 20px;background:var(--ds-primary);color:white;border:0;border-radius:var(--ds-radius)}.cards{display:flex;gap:20px;margin-top:20px}.cards>div{padding:24px;width:240px;border:1px solid var(--ds-border);border-radius:var(--ds-radius)}</style></head><body><button id="action">查看任务</button><h1>研究进展</h1><p>这是保存的代表性页面，参数修改不重建此页面。</p><div class="cards"><div>文献证据<br>12 项待阅读</div><div>研究计划<br>3 个待完成步骤</div></div><script>
    let count=0,hostAccess=false;try{hostAccess=Boolean(parent.document.body)}catch{}
    function report(){parent.postMessage({probe:'style-preview',count,hostAccess,color:getComputedStyle(document.getElementById('action')).backgroundColor,css:getComputedStyle(document.body).getPropertyValue('--fixture-css').trim()},'*')}
    document.getElementById('action').onclick=()=>{count++;report()};new MutationObserver(report).observe(document.documentElement,{attributes:true,attributeFilter:['style']});report();
  </script></body></html>`
  const styleArtifacts = { 'design_style/preview.html': styleHtml, 'design_style/tokens.css': ':root { --fixture-css: hydrated; }' }
  await store.write('design_style', styleState, { validate: bundles.design_style.validate, artifacts: styleArtifacts, origin: 'panel', settleEvent: async () => {} })
  const businessState = { schema_version: 3, objects: Object.fromEntries(['root', 'left', 'right', 'leaf'].map(id => [id,
    { id, name: id, description: `${id} meaning`, fields: {}, field_order: [], states: {}, state_order: [] }])), object_order: ['root', 'left', 'right', 'leaf'],
    relations: Object.fromEntries([['a', 'left', 'root'], ['b', 'right', 'root'], ['c', 'leaf', 'left'], ['d', 'leaf', 'right']].map(([id, source, target]) =>
      [id, { id, source, target, kind: 'generalization', name: id }])) }
  businessState.relations.link = { id: 'link', source: 'root', target: 'leaf', kind: 'association', name: 'References', target_count: '0..*' }
  await store.write('business_data', businessState, { validate: bundles.business_data.validate, origin: 'panel', settleEvent: async () => {} })
  const visualCli = installedVisualCli(root)
  await run(visualCli.command, visualCli.args, {
    cwd: root, env: { ...environment, VISUAL_TEST_OUT: out, VISUAL_TEST_ENTRY: './web-app-browser.tsx' },
    signal: controller.signal, timeout: 120000, maxBuffer: 3e6,
  })
  server = createServer(async (req, res) => {
    try {
      if (req.url === '/' || req.url.startsWith('/?')) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script>'); return }
      if (req.url.startsWith('/fixture?')) {
        const name = new URL(req.url, 'http://localhost').searchParams.get('bundle')
        if (!Object.hasOwn(bundles, name)) throw Error('unknown bundle')
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ state: await store.read(name) ?? (name === 'smart_questions' ? initial : {}), panel: bundles[name].panel,
          ...(name === 'research' ? { artifactFiles: Object.fromEntries(Object.keys(researchArtifacts).map(path => [path, 'fixture-digest'])), executionAttempts: researchAttempts } : {}),
          ...(name === 'flow_design' ? { artifactFiles: { 'flow_design/P-001.bpmn': 'fixture-digest' } } : {}) })); return
      }
      if (req.url.startsWith('/execution-log?')) {
        const query = new URL(req.url, 'http://localhost').searchParams
        if (query.get('run') !== 'child-run') throw Error('unexpected execution log')
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ found: true, revision: 'log1', reset: false, entries: query.get('after') ? [] : [{ seq: 1, timestamp: 1, eventType: 'search', message: '正在核对来源，而非已完成结论' }] })); return
      }
      if (req.url === '/external-canvas' && req.method === 'POST') {
        const state = await store.read('whiteboard'), path = state.boards[state.board_order[0]].artifact_file
        const scene = JSON.parse(await readFile(join(project, path), 'utf8'))
        scene.elements[0].strokeColor = '#ff0000'
        await store.write('whiteboard', state, { validate: bundles.whiteboard.validate, artifacts: { [path]: JSON.stringify(scene) }, origin: 'panel', settleEvent: async () => {} })
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ artifactFiles: { [path]: `canvas-${++canvasRevision}` } })); return
      }
      if (req.url.startsWith('/text-artifact?')) {
        const path = new URL(req.url, 'http://localhost').searchParams.get('path')
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(path === 'flow_design/P-001.bpmn' || /^whiteboard\/boards\/[a-zA-Z0-9_-]+\.json$/.test(path) || path === 'web_app_prd_assembly/prd.html' || Object.hasOwn(researchArtifacts, path) || Object.hasOwn(styleArtifacts, path) ? { found: true, content: await readFile(join(project, path), 'utf8') } : { found: false, content: '' })); return
      }
      if (req.url.startsWith('/artifact?')) {
        const path = new URL(req.url, 'http://localhost').searchParams.get('path')
        if (!/^(smart_questions|whiteboard)\/attachments\/[a-zA-Z0-9_-]+\.(png|jpg|webp|attachment)$/.test(path)) throw Error('invalid artifact')
        const bytes = await readFile(join(project, path))
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ found: true, mediaType: 'image/png', base64: bytes.toString('base64'), byteLength: bytes.length })); return
      }
      if (req.url === '/save' && req.method === 'POST') {
        let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 1e6) throw Error('too large') }
        const { state, artifacts, name } = JSON.parse(text)
        if (!Object.hasOwn(bundles, name)) throw Error('unknown bundle')
        const files = Object.fromEntries((artifacts ?? []).map(item => {
          if (name === 'flow_design' && item.path === 'flow_design/P-001.bpmn' && item.encoding === undefined) return [item.path, item.content]
          if (name === 'whiteboard' && /^whiteboard\/boards\/[a-zA-Z0-9_-]+\.json$/.test(item.path) && item.encoding === undefined) return [item.path, item.content]
          if (item.encoding !== 'base64') throw Error('invalid encoding')
          return [item.path, Buffer.from(item.content, 'base64')]
        }))
        await store.write(name, state, { validate: bundles[name].validate, artifacts: files, origin: 'panel', settleEvent: async () => {} })
        res.end('saved'); return
      }
      const path = resolve(out, `.${req.url}`)
      if (!path.startsWith(`${out}/`)) throw Error('invalid path')
      res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'text/javascript'); res.end(await readFile(path))
    } catch (error) { res.writeHead(400); res.end(String(error)) }
  })
  await listenForServer(server, controller.signal)
  serverLifecycle.push({ operation: 'listen', success: true })
  const url = `http://127.0.0.1:${server.address().port}`
  const check = async code => assert.equal((await browser('eval', code)).trim(), 'true', code)
  if (!process.env.STYLE_ONLY && !process.env.BUSINESS_ONLY) {
  await browser('open', url)
  await browser('wait', '[data-question-id=scope] textarea')
  await browser('snapshot', '-i')
  await browser('fill', '[data-question-id=scope] textarea', '先验证问题清单的完整交互')
  const imagePath = join(temporary, 'test.png')
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  await writeFile(imagePath, imageBytes)
  await browser('upload', '[data-question-id=scope] input[type=file]', imagePath)
  await browser('wait', '--fn', 'document.querySelector("[data-question-id=scope]").textContent.includes("test.png")')
  await browser('find', 'text', '网页', 'click')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("[role=status]").textContent === "已保存"')
  const saved = await store.read('smart_questions')
  assert.equal(saved.questions.scope.answer, '先验证问题清单的完整交互')
  assert.equal(saved.questions.channels.answer, 'web')
  assert.equal(saved.questions.scope.multimodal_answer.length, 1)
  assert.deepEqual(await readFile(join(project, saved.questions.scope.multimodal_answer[0].artifact_file)), imageBytes)
  assert.equal(saved.__dsh_panel_artifacts, undefined)
  assert.deepEqual(saved.questions.old, initial.questions.old)
  await browser('open', url); await browser('wait', '[data-question-id=scope]')
  await check('document.querySelector("[data-question-id=scope]").textContent.includes("先验证问题清单的完整交互")')
  await browser('wait', '--fn', 'Array.from(document.querySelectorAll("[data-question-id=scope] img")).some(image => image.complete && image.naturalWidth > 0)')
  await browser('find', 'role', 'button', 'click', '--name', '第 1 轮')
  await check('!!document.querySelector("[data-question-id=const_auth_mode]") && !document.querySelector("textarea") && !document.querySelector("[data-testid=standard-question-edit]")')
  await browser('find', 'role', 'button', 'click', '--name', '第 2 轮')
  await browser('set', 'viewport', '1280', '900')
  await browser('screenshot', join(screenshots, 'questions-wide.png'))
  await browser('set', 'viewport', '620', '900')
  await check('document.documentElement.scrollWidth <= innerWidth + 1')
  await check('document.querySelector(".dsh-panel-workspace").getBoundingClientRect().height > innerHeight * .75')
  await browser('screenshot', join(screenshots, 'questions-narrow.png'))
  await browser('set', 'viewport', '1280', '900')
  completedBundles.push('smart_questions')
  await browser('open', `${url}/?bundle=quality_acceptance`)
  await browser('find', 'role', 'button', 'click', '--name', '添加验收要求', '--exact')
  await browser('fill', '[data-field=title] input', '提交订单后给出订单号')
  await browser('fill', '[data-field=condition] textarea', '填写订单后点击提交')
  await browser('fill', '[data-field=pass_criteria] textarea', '显示唯一订单号')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("[role=status]").textContent === "已保存"')
  const accepted = await store.read('quality_acceptance')
  const acceptedId = accepted.requirement_order[0]
  assert.equal(accepted.schema_version, 4)
  assert.equal(accepted.requirements[acceptedId].id, acceptedId)
  assert.equal(accepted.requirements[acceptedId].pass_criteria, '显示唯一订单号')
  await browser('open', `${url}/?bundle=quality_acceptance`)
  await browser('wait', '[data-field=title] input')
  await check('document.querySelector("[data-field=title] input").value === "提交订单后给出订单号"')
  await check('document.querySelector(".dsh-record-inspector").getBoundingClientRect().width > 900')
  await browser('screenshot', join(screenshots, 'acceptance.png'))
  completedBundles.push('quality_acceptance')
  await browser('open', `${url}/?bundle=notification_design`)
  await browser('find', 'role', 'button', 'click', '--name', '添加通知', '--exact')
  await browser('fill', '[data-field=title] input', '订单待审批')
  await browser('fill', '[data-field=recipients] input', '订单创建人')
  await browser('press', 'Enter')
  await browser('fill', '[data-field=channels] input', '企业邮箱')
  await browser('press', 'Enter')
  await browser('fill', '[data-field=message] textarea', '你的订单需要审批')
  await check('document.querySelector(".dsh-record-preview").textContent.includes("你的订单需要审批")')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("[role=status]").textContent === "已保存"')
  const notified = await store.read('notification_design')
  const notification = notified.notifications[notified.notification_order[0]]
  assert.deepEqual(notification.channels, ['in_app', '企业邮箱'])
  assert.deepEqual(notification.recipients, ['订单创建人'])
  await browser('screenshot', join(screenshots, 'notification.png'))
  completedBundles.push('notification_design')
  await browser('open', `${url}/?bundle=business_rules&locale=en-US`)
  await browser('find', 'role', 'button', 'click', '--name', 'Add rule', '--exact')
  await browser('fill', '[data-field=title] input', 'Order threshold')
  await browser('fill', '[data-field=outcome] textarea', 'Require approval above the threshold')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("[role=status]").textContent === "已保存"')
  const rules = await store.read('business_rules')
  assert.equal(rules.schema_version, 4)
  assert.equal(rules.rules[rules.rule_order[0]].id, rules.rule_order[0])
  assert.equal(rules.rules[rules.rule_order[0]].title, 'Order threshold')
  await browser('open', `${url}/?bundle=business_rules&locale=zh-CN`)
  await browser('wait', '[data-field=title] input')
  await check('document.querySelector("[data-field=title] input").value === "Order threshold"')
  await check('document.body.textContent.includes("当前规则名称")')
  await browser('screenshot', join(screenshots, 'rules.png'))
  completedBundles.push('business_rules')
  await browser('open', `${url}/?bundle=integration_design&locale=en-US`)
  await browser('find', 'role', 'button', 'click', '--name', 'Add Integration', '--exact')
  await browser('snapshot', '-i')
  await browser('fill', '[data-field=title] input', 'Shipment creation')
  await browser('fill', '[data-field=description] textarea', 'Create a warehouse shipment')
  await browser('fill', '[data-field=url] input', 'https://warehouse.example.com/docs')
  await browser('find', 'role', 'button', 'click', '--name', 'Add Credential', '--exact')
  await browser('snapshot', '-i')
  await browser('fill', '[data-record-map=secrets] input:first-of-type', 'warehouse-api-key')
  await browser('fill', '[data-record-map=secrets] label:nth-of-type(2) input', 'Required to create shipments')
  await browser('fill', '[data-field=prompt_content] textarea', 'Create after approval and return the identifier')
  await browser('fill', '[data-field=business_rules] textarea', 'Preserve the order on failure')
  await check('document.querySelector("[data-field=description] textarea").maxLength === 500 && document.querySelector("[data-field=url] input").type === "url"')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("[role=status]").textContent === "已保存"')
  const integrated = await store.read('integration_design')
  const connection = integrated.integrations[integrated.integration_order[0]]
  assert.equal(integrated.schema_version, 8)
  assert.equal(connection.id, integrated.integration_order[0])
  assert.equal(connection.secrets[connection.secret_order[0]].id, connection.secret_order[0])
  assert.equal(connection.secrets[connection.secret_order[0]].name, 'WAREHOUSE_API_KEY')
  await browser('open', `${url}/?bundle=integration_design`)
  await browser('wait', '[data-record-map=secrets] input')
  await check('document.querySelector("[data-field=title] input").value === "Shipment creation"')
  await browser('screenshot', join(screenshots, 'integration.png'))
  await browser('find', 'role', 'button', 'click', '--name', '删除凭据 1', '--exact')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("[role=status]").textContent === "已保存"')
  const withoutSecret = await store.read('integration_design')
  assert.deepEqual(withoutSecret.integrations[connection.id].secrets, {})
  assert.deepEqual(withoutSecret.integrations[connection.id].secret_order, [])
  assert.equal(withoutSecret.integrations[connection.id].prompt_content, connection.prompt_content)
  completedBundles.push('integration_design')
  await browser('open', `${url}/?bundle=role_access`)
  await browser('find', 'role', 'button', 'click', '--name', '添加角色', '--exact')
  await browser('snapshot', '-i')
  await browser('fill', '[data-field=title] input', '审批人')
  await browser('click', '[data-field=assignment_rule] label:first-child input[type=radio]')
  await browser('click', '.dsh-record-related-editor header button')
  await browser('snapshot', '-i')
  await browser('fill', '[data-field=capability] input', '审批订单')
  await browser('scroll', 'down', '450', '--selector', '.dsh-record-inspector')
  await browser('snapshot', '-i')
  await browser('check', '[data-field=requirements] input[value=custom]')
  await browser('fill', '[data-field=custom_requirement] input', '征得负责人同意')
  await browser('check', '[data-field=requirements] input[value=confirm]')
  await browser('uncheck', '[data-field=requirements] input[value=custom]')
  await check('document.querySelector("[data-field=custom_requirement]") === null')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("[role=status]").textContent === "已保存"')
  const authorized = await store.read('role_access')
  const roleId = authorized.role_order[0], policyId = authorized.policy_order[0]
  assert.equal(authorized.roles[roleId].assignment_rule, '注册后自动拥有')
  assert.equal(authorized.policies[policyId].role_ref, roleId)
  assert.equal(authorized.policies[policyId].title, '允许审批订单')
  assert.deepEqual(authorized.policies[policyId].requirements, ['confirm'])
  assert.equal(authorized.policies[policyId].custom_requirement, '')
  await browser('open', `${url}/?bundle=role_access&locale=en-US`)
  await browser('wait', '[data-field=capability] input')
  await check('document.querySelector("[data-field=capability] input").value === "审批订单"')
  await browser('screenshot', join(screenshots, 'roles.png'))
  completedBundles.push('role_access')
  await browser('open', `${url}/?bundle=function_modules`)
  await browser('wait', '.dsh-record-board')
  await browser('find', 'role', 'button', 'click', '--name', '添加功能', '--exact')
  await browser('snapshot', '-i')
  await browser('fill', '[data-field=function_name] input', '查找证据')
  await browser('fill', '[data-field=function_description] textarea', '围绕研究问题查看已保存的材料。')
  await browser('fill', '[data-field=function_epic] input', '文献阅读')
  await browser('select', '[data-field=priority] select', 'High')
  await browser('click', '.dsh-record-board-editor > details > summary')
  await browser('scroll', 'down', '400', '--selector', '.dsh-record-board-content')
  await browser('snapshot', '-i')
  await browser('fill', '[data-field=purpose] textarea', '保留可追溯依据')
  await browser('click', '[data-record-map=behaviors] > button')
  await browser('fill', '[data-record-map=behaviors] textarea', '从论点定位对应的文献片段')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const mapped = await store.read('function_modules')
  const functionId = Object.keys(mapped.functions)[0]
  const behaviorId = Object.keys(mapped.functions[functionId].details.behaviors)[0]
  assert.deepEqual(mapped.functions[functionId].details.behaviors[behaviorId], { description: '从论点定位对应的文献片段' })
  assert.equal(mapped.functions[functionId].function_id, functionId)
  assert.equal(mapped.functions[functionId].priority, 'High')
  assert.equal(Object.hasOwn(mapped, 'epics'), false)
  await browser('open', `${url}/?bundle=function_modules&locale=en-US`)
  await browser('wait', '.dsh-record-board')
  await browser('find', 'role', 'button', 'click', '--name', 'Reject', '--exact')
  await check('document.querySelector("[data-board-record]") === null')
  await browser('select', 'select[aria-label="Filter records"]', 'rejected')
  await browser('find', 'role', 'button', 'click', '--name', 'Restore', '--exact')
  await browser('select', 'select[aria-label="Filter records"]', 'active')
  await browser('find', 'role', 'button', 'click', '--name', 'Mind map', '--exact')
  await browser('wait', '.react-flow__node')
  await check('document.querySelectorAll(".react-flow__node").length === 2')
  await browser('screenshot', join(screenshots, 'function-map.png'))
  await browser('click', '.react-flow__node[data-id^="record:"]')
  await browser('wait', '[data-field=function_name] input')
  await check('document.querySelector("[data-field=function_name] input").value === "查找证据"')
  await browser('screenshot', join(screenshots, 'function-board.png'))
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const restored = await store.read('function_modules')
  assert.equal(restored.functions[functionId].rejected, false)
  assert.deepEqual(restored.functions[functionId].details, mapped.functions[functionId].details)
  completedBundles.push('function_modules')
  await browser('open', `${url}/?bundle=web_app_prd_assembly`)
  await browser('wait', '.dsh-document-workspace iframe')
  await browser('wait', '--fn', 'document.querySelector(".dsh-document-workspace").textContent.includes("功能范围")')
  await check('!window.__unsafePrdScript && document.querySelector("iframe").getAttribute("sandbox") === "allow-same-origin"')
  await check('document.querySelector(".dsh-document-legend").textContent.includes("待确认 ×1")')
  await browser('find', 'role', 'button', 'click', '--name', '功能模块', '--exact')
  await check('document.querySelector("footer [role=status]").textContent === "navigate:function_modules"')
  await browser('find', 'role', 'button', 'click', '--name', '质量验收', '--exact')
  await browser('wait', '--fn', 'document.querySelector("iframe").contentWindow.scrollY > 500')
  await browser('screenshot', join(screenshots, 'prd.png'))
  await browser('find', 'role', 'button', 'click', '--name', '刷新', '--exact')
  await browser('wait', '--fn', '!document.querySelector(".dsh-document-body").matches("[aria-busy=true]")')
  assert.deepEqual(await store.read('web_app_prd_assembly'), documentState)
  assert.equal(await readFile(join(project, 'web_app_prd_assembly/prd.html'), 'utf8'), documentHtml)
  completedBundles.push('web_app_prd_assembly')
  await browser('open', `${url}/?bundle=research`)
  await browser('wait', '.dsh-artifact-workspace')
  await browser('wait', '--fn', 'document.querySelector(".dsh-artifact-content").textContent.includes("正在核对来源")')
  await browser('find', 'role', 'button', 'click', '--name', '当前资料', '--exact')
  await browser('wait', '.dsh-artifact-markdown strong')
  await check('document.querySelector(".dsh-artifact-markdown strong").textContent === "独立的新证据"')
  await browser('screenshot', join(screenshots, 'research-report.png'))
  await browser('find', 'role', 'button', 'click', '--name', '已完成的历史调研', '--exact')
  await browser('wait', '.dsh-artifact-preview iframe')
  await browser('wait', '--fn', 'document.querySelector("iframe").contentDocument.body.textContent.includes("历史结论")')
  await browser('find', 'role', 'button', 'click', '--name', '历史资料', '--exact')
  await browser('wait', '--fn', 'document.querySelector(".dsh-artifact-markdown")?.textContent.includes("历史报告")')
  await check('!document.querySelector(".dsh-artifact-content").textContent.includes("正在核对来源")')
  assert.deepEqual(await store.read('research'), researchState)
  completedBundles.push('research')
  await browser('open', `${url}/?bundle=flow_design`)
  await browser('wait', '.dsh-bpmn-canvas .djs-element')
  await browser('snapshot', '-i')
  await check('document.querySelector(".dsh-bpmn-canvas").getBoundingClientRect().height > 350')
  await browser('screenshot', join(screenshots, 'flow.png'))
  await browser('find', 'role', 'button', 'click', '--name', '编辑图形', '--exact')
  await browser('wait', '.djs-palette')
  await browser('snapshot', '-i')
  const taskId = /<bpmn:(?:userTask|task|serviceTask)\b[^>]*\bid="([^"]+)"/u.exec(flowXml)?.[1]
  assert.ok(taskId, 'real fixture has a task')
  await browser('dblclick', `.djs-element[data-element-id="${taskId}"]`)
  await browser('wait', '.djs-direct-editing-content')
  await browser('fill', '.djs-direct-editing-content', '已核对的流程步骤')
  // Save while direct editing still has focus: barrier must complete it first.
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  assert.match(await readFile(join(project, 'flow_design/P-001.bpmn'), 'utf8'), /已核对的流程步骤/)
  assert.deepEqual(await store.read('flow_design'), flowState, 'XML never leaks into canonical state')
  await browser('open', `${url}/?bundle=flow_design&locale=en-US`)
  await browser('wait', '.dsh-bpmn-canvas .djs-element')
  await check('document.querySelector(".dsh-bpmn-canvas").textContent.includes("已核对的流程步骤")')
  await browser('check', 'footer input[type=checkbox]')
  await check('Array.from(document.querySelectorAll("button")).find(e=>e.textContent === "Edit diagram").disabled')
  completedBundles.push('flow_design')
  await browser('open', `${url}/?bundle=whiteboard`)
  await browser('snapshot', '-i')
  await browser('find', 'role', 'button', 'click', '--name', '新建主题', '--exact')
  await browser('wait', '.excalidraw canvas')
  await browser('snapshot', '-i')
  await browser('fill', '.dsh-canvas-heading input', '可共同编辑的研究思路')
  await browser('click', 'input[aria-label="矩形"]')
  await browser('mouse', 'move', '650', '300'); await browser('mouse', 'down')
  await browser('mouse', 'move', '850', '430'); await browser('mouse', 'up')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const drawn = await store.read('whiteboard'), boardId = drawn.board_order[0], scenePath = drawn.boards[boardId].artifact_file
  const firstScene = JSON.parse(await readFile(join(project, scenePath), 'utf8'))
  assert.ok(firstScene.elements.some(element => element.type === 'rectangle' && !element.isDeleted))
  assert.deepEqual(Object.keys(drawn).sort(), ['board_order', 'boards'])
  assert.deepEqual(Object.keys(firstScene.appState), ['viewBackgroundColor'])
  await browser('open', `${url}/?bundle=whiteboard&locale=en-US`)
  await browser('wait', '.excalidraw canvas')
  await check('document.querySelector(".dsh-canvas-heading input").value === "可共同编辑的研究思路"')
  await check('document.querySelector(".dsh-canvas-editor").getBoundingClientRect().height > 650')
  await browser('screenshot', join(screenshots, 'whiteboard.png'))
  await browser('click', 'input[aria-label="Rectangle"]')
  await browser('mouse', 'move', '630', '590'); await browser('mouse', 'down')
  await browser('mouse', 'move', '860', '700'); await browser('mouse', 'up')
  await browser('find', 'role', 'button', 'click', '--name', '模拟外部场景更新', '--exact')
  await browser('wait', '--fn', 'Array.from(document.querySelectorAll("[role=alert]")).some(e=>e.textContent.includes("unsaved scene is retained"))')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const retainedScene = JSON.parse(await readFile(join(project, scenePath), 'utf8'))
  assert.equal(retainedScene.elements.filter(element => !element.isDeleted).length, 2, 'unsaved drawing survives external update')
  assert.notEqual(retainedScene.elements[0].strokeColor, '#ff0000', 'explicit save uses the preserved local scene')
  // Drop an actual PNG through the native editor DOM, not through an editor API.
  await browser('eval', `(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(imageBytes.toString('base64'))}), character => character.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'drawing.png', { type: 'image/png' }));
    document.querySelector('.excalidraw canvas').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 700, clientY: 380 }));
  })()`)
  await browser('wait', '--fn', 'window.declarativeTestDraft.__dsh_panel_text_artifacts?.some(item => item.assets?.length > 0)')
  const nativeImageBase64 = JSON.parse((await browser('eval', 'window.declarativeTestDraft.__dsh_panel_text_artifacts.flatMap(item => item.assets ?? [])[0].content')).trim())
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const imageScene = JSON.parse(await readFile(join(project, scenePath), 'utf8'))
  const attachedImage = Object.values(imageScene.files)[0]
  assert.ok(attachedImage, 'dropped image became an external scene attachment')
  const savedImageBytes = await readFile(join(project, attachedImage.path))
  // Excalidraw normalizes a dropped PNG through canvas. Persist exactly the
  // native editor bytes, not the pre-normalization upload or a second encoding.
  assert.deepEqual(savedImageBytes, Buffer.from(nativeImageBase64, 'base64'))
  assert.deepEqual(savedImageBytes.subarray(0, 8), imageBytes.subarray(0, 8))
  assert.ok(!JSON.stringify(imageScene).includes('data:image'))
  await browser('open', `${url}/?bundle=whiteboard&locale=en-US`)
  await browser('wait', '.excalidraw canvas')
  await check('!Array.from(document.querySelectorAll("[role=alert]")).some(e=>e.textContent.includes("images could not be read"))')
  await browser('find', 'role', 'button', 'click', '--name', 'New topic', '--exact')
  await browser('wait', '.excalidraw canvas')
  await browser('fill', '.dsh-canvas-heading input', '第二个主题')
  await browser('find', 'role', 'button', 'click', '--name', 'Move up', '--exact')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const reordered = await store.read('whiteboard')
  assert.equal(reordered.board_order.length, 2)
  assert.equal(reordered.board_order[1], boardId)
  assert.deepEqual(JSON.parse(await readFile(join(project, scenePath), 'utf8')), imageScene)
  await browser('check', 'footer input[type=checkbox]')
  await check('document.querySelector(".dsh-canvas-heading input").disabled && document.querySelector(".dsh-panel-workspace-tree-add").disabled')
  completedBundles.push('whiteboard')
  }
  if (!process.env.BUSINESS_ONLY) {
  await browser('open', `${url}/?bundle=design_style`)
  await browser('wait', '--fn', 'window.previewProbe?.color === "rgb(18, 52, 86)"')
  await check('window.previewProbe.hostAccess === false && document.querySelector(".dsh-live-preview iframe").contentDocument === null && window.previewProbe.css === "hydrated"')
  const clickPoint = JSON.parse(await browser('eval', '(()=>{const f=document.querySelector(".dsh-live-preview iframe"),r=f.getBoundingClientRect(),scale=r.width/1280;return [r.x+80*scale,r.y+52*scale]})()'))
  await browser('mouse', 'move', ...clickPoint.map(value => String(Math.round(value)))); await browser('mouse', 'down'); await browser('mouse', 'up')
  await browser('wait', '--fn', 'window.previewProbe?.count === 1')
  await browser('find', 'role', 'button', 'click', '--name', '节庆朱橙', '--exact')
  await browser('wait', '--fn', 'window.previewProbe?.color === "rgb(232, 90, 44)"')
  await check('window.previewProbe.count === 1 && window.declarativeTestDraft.config.preview_page.html_file === "design_style/preview.html"')
  await browser('find', 'role', 'button', 'click', '--name', '恢复初始设置', '--exact')
  await browser('wait', '--fn', 'window.previewProbe?.color === "rgb(18, 52, 86)"')
  await browser('find', 'role', 'button', 'click', '--name', '微调设置', '--exact')
  await browser('fill', 'input[type=text][aria-label="主色"]', '#abcdef')
  await browser('wait', '--fn', 'window.previewProbe?.color === "rgb(171, 205, 239)"')
  await check('window.previewProbe.count === 1')
  await browser('find', 'role', 'button', 'click', '--name', '保存并重新生成', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "save-and-continue-requested"')
  await browser('find', 'role', 'button', 'click', '--name', '关闭', '--exact')
  await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const savedStyle = await store.read('design_style')
  assert.equal(savedStyle.config.colors.primary, '#abcdef')
  assert.deepEqual(savedStyle.config.component_patterns, styleState.config.component_patterns)
  assert.deepEqual(savedStyle.config.preview_page, styleState.config.preview_page)
  assert.equal(savedStyle.config.typography.privateFont, 'keep')
  assert.equal(await readFile(join(project, 'design_style/preview.html'), 'utf8'), styleHtml)
  await browser('open', `${url}/?bundle=design_style&locale=en-US`)
  await browser('wait', '--fn', 'window.previewProbe?.color === "rgb(171, 205, 239)"')
  await browser('screenshot', join(screenshots, 'design-style.png'))
  await browser('check', 'footer input[type=checkbox]')
  await check('Array.from(document.querySelectorAll(".dsh-preview-workspace .dsh-panel-workspace-choice")).every(button=>button.disabled)')
  await browser('find', 'role', 'button', 'click', '--name', 'Adjust settings', '--exact')
  await check('!document.querySelector(".dsh-preview-adjustments input")')
  completedBundles.push('design_style')
  }
  if (!process.env.STYLE_ONLY) {
    await browser('open', `${url}/?bundle=business_data&locale=en-US`)
    await browser('wait', '.dsh-record-inspector [data-field=name] input')
    await browser('snapshot', '-i')
    await browser('find', 'role', 'button', 'click', '--name', 'References', '--exact')
    await browser('find', 'role', 'button', 'click', '--name', 'Swap endpoints', '--exact')
    await check('window.declarativeTestDraft.relations.link.source === "leaf" && window.declarativeTestDraft.relations.link.source_count === "0..*" && !Object.hasOwn(window.declarativeTestDraft.relations.link,"target_count")')
    await browser('select', '[data-field=kind] select', 'generalization')
    await check('!Object.hasOwn(window.declarativeTestDraft.relations.link,"source_count") && !Object.hasOwn(window.declarativeTestDraft.relations.link,"target_count")')
    // Restore an association so root remains a higher ancestor, not an extra direct parent.
    await browser('select', '[data-field=kind] select', 'association')
    await browser('find', 'role', 'button', 'click', '--name', 'Relationship canvas', '--exact')
    await browser('wait', '--fn', 'document.querySelectorAll(".react-flow__node").length === 4 && document.querySelectorAll(".react-flow__edge").length === 5')
    await browser('snapshot', '-i')
    await browser('click', '.react-flow__node[data-id="node:leaf"]')
    await check('document.querySelector(".dsh-record-inspector").getBoundingClientRect().height > 0 && document.querySelector(".dsh-visual-canvas").getBoundingClientRect().height > 0')
    await check('document.querySelector(".dsh-record-graph-summary").textContent.includes("Higher ancestors") && document.querySelector(".dsh-record-graph-summary").textContent.includes("Related relationships") && !document.querySelector(".dsh-record-graph-summary input")')
    await check('document.querySelector(".dsh-record-graph-summary").textContent.includes("leaf → References → root")')
    await browser('scroll', 'down', '300', '--selector', '.dsh-record-graph-summary')
    await browser('find', 'role', 'button', 'click', '--name', 'leaf → References → root', '--exact')
    await check('!document.querySelector(".dsh-record-inspector [data-field=kind] select").disabled')
    await browser('click', '.react-flow__node[data-id="node:leaf"]')
    await browser('hover', '.react-flow__node[data-id="node:leaf"]')
    await browser('click', '.react-flow__node[data-id="node:leaf"] .dsh-business-node-detail')
    await check('document.querySelector(".dsh-record-inspector").textContent.includes("Parent definitions")')
    await check('Array.from(document.querySelectorAll(".dsh-record-inspector .dsh-record-context-summary button")).map(b=>b.textContent).includes("left") && Array.from(document.querySelectorAll(".dsh-record-inspector .dsh-record-context-summary button")).map(b=>b.textContent).includes("right")')
    await browser('fill', '.dsh-record-inspector [data-field=name] input', 'Renamed leaf')
    await browser('find', 'role', 'button', 'click', '--name', '保存', '--exact')
    await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    const savedBusiness = await store.read('business_data')
    assert.equal(savedBusiness.objects.leaf.name, 'Renamed leaf')
    assert.equal(savedBusiness.relations.link.source, 'leaf')
    assert.equal(Object.hasOwn(savedBusiness.relations.link, 'source_count'), false)
    assert.deepEqual(savedBusiness.objects.leaf.fields, {})
    await browser('open', `${url}/?bundle=business_data&locale=en-US`)
    await browser('wait', '.dsh-record-inspector')
    await browser('find', 'role', 'button', 'click', '--name', 'Relationship canvas', '--exact')
    await browser('wait', '--fn', 'document.querySelectorAll(".react-flow__node").length === 4 && document.querySelector(".react-flow").textContent.includes("Renamed leaf")')
    await browser('screenshot', join(screenshots, 'business-data.png'))
    await browser('click', '.react-flow__controls-zoomin')
    await browser('wait', '400')
    await browser('eval', 'window.businessViewport = document.querySelector(".react-flow__viewport").style.transform')
    await browser('click', '.dsh-workspace-view-switch button:first-child')
    await browser('find', 'role', 'button', 'click', '--name', 'Relationship canvas', '--exact')
    await browser('wait', '400')
    await check('document.querySelector(".react-flow__viewport").style.transform === window.businessViewport')
    await browser('check', 'footer input[type=checkbox]')
    await check('!Array.from(document.querySelectorAll(".dsh-relation-graph button")).some(button=>button.textContent.includes("Add relationship"))')
    await browser('click', '.react-flow__node[data-id="node:leaf"]')
    await check('!!document.querySelector(".dsh-record-graph-summary") && !document.querySelector(".dsh-record-graph-summary input,.dsh-record-graph-summary textarea,.dsh-record-graph-summary select")')
    await browser('eval', 'document.querySelector(\'.react-flow__node[data-id="node:leaf"] .dsh-business-node-detail\').focus()')
    await check('getComputedStyle(document.activeElement).opacity === "1" && document.activeElement.classList.contains("dsh-business-node-detail")')
    await browser('press', 'Enter')
    await check('document.querySelector(".dsh-record-inspector").getBoundingClientRect().height > 0')
    await check('Array.from(document.querySelectorAll(".dsh-record-inspector input,.dsh-record-inspector textarea,.dsh-record-inspector select")).every(input=>input.disabled || input.readOnly)')
    await browser('find', 'role', 'button', 'click', '--name', 'References', '--exact')
    await check('!Array.from(document.querySelectorAll(".dsh-record-inspector button")).some(button=>button.textContent.includes("Swap endpoints"))')
    await browser('set', 'viewport', '620', '800')
    await browser('find', 'role', 'button', 'click', '--name', 'Relationship canvas', '--exact')
    await check('getComputedStyle(document.querySelector(".is-canvas-details")).gridTemplateColumns.trim().split(/\\s+/).length === 1')
    await check('getComputedStyle(document.querySelector(".is-canvas-details > div:last-child")).borderLeftWidth === "0px"')
    await browser('screenshot', join(screenshots, 'business-data-narrow.png'))
    await browser('scroll', 'down', '650', '--selector', '.dsh-panel-workspace-main')
    await check('(() => { const e=document.querySelector(".dsh-record-inspector [data-field=kind]"); if (!e) return false; const r=e.getBoundingClientRect(), main=document.querySelector(".dsh-panel-workspace-main").getBoundingClientRect(); return r.top >= main.top && r.bottom <= main.bottom })()')
    await browser('screenshot', join(screenshots, 'business-data-narrow-detail.png'))
    completedBundles.push('business_data')
  }
  assert.deepEqual(completedBundles, expectedBundles, 'Every declared bundle must finish all its original assertions')
  console.log(JSON.stringify({ scopedBrowserAssertionsPassed: true, completedBundles,
    excludedFromThisHarness: ['page_design'], all14Accepted: false, evidenceDirectory: temporary }))
} catch (error) {
  failure = error.stack ?? String(error)
  await browser('screenshot', join(screenshots, 'failure.png')).catch(() => {})
  console.error(await browser('eval', 'JSON.stringify(Array.from(document.querySelectorAll(".dsh-record-inspector,.dsh-record-workspace-body,.dsh-panel-workspace-main,footer")).map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),scroll:e.scrollHeight,client:e.clientHeight})))').catch(() => ''))
  throw error
} finally {
  clearTimeout(deadline)
  if (browserAttempted) await browser('close').catch(error => cleanupErrors.push(String(error)))
  if (server) {
    const observation = await closeServerObserved(server)
    serverLifecycle.push({ operation: 'close', ...observation })
    if (observation.error) cleanupErrors.push(observation.error)
  }
  const receipt = { session, evidenceDirectory: temporary, project, screenshots,
    expectedBundles, completedBundles, excludedFromThisHarness: ['page_design'], all14Accepted: false,
    toolPins, commands, serverLifecycle,
    forcedServerClose: serverLifecycle.some(item => item.forcedServerClose),
    deadlineExceeded: controller.signal.aborted, failure, cleanupErrors,
    success: !failure && cleanupErrors.length === 0 && !controller.signal.aborted
      && JSON.stringify(completedBundles) === JSON.stringify(expectedBundles) }
  await writeFile(join(temporary, 'RESULT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ receipt: join(temporary, 'RESULT.json'), success: receipt.success }))
  if (!receipt.success) process.exitCode = 1
  // Retain the isolated project, compiled fixture, and screenshots on success and failure.

}
