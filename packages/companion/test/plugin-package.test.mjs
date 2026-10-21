import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, chmod, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DesignProjectManager } from '../../core/lib/index.js'
import { packagePlugin } from '../build-plugin.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright'

const run = promisify(execFile)
const thread = '00000000-0000-4000-8000-000000000001'

function start(entry, args, options) {
  const child = spawn(process.execPath, [entry, ...args], options)
  let out = '', err = ''
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.stderr.on('data', bytes => { err += bytes })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Startup timed out: ${err}`)) }, 15000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Exited before ready: ${err}`)) })
    child.stdout.on('data', bytes => {
      out += bytes
      if (!out.includes('\n')) return
      clearTimeout(timer)
      try { resolve(JSON.parse(out.split('\n')[0])) } catch (error) { reject(error) }
    })
  })
  return { child, ready, exited }
}

test('relocated plugin runs without repo modules; real files/save plus exact queue subprocess binding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-plugin-relocation-'))
  let service
  const withBrowser = process.env.COMPANION_BROWSER_TEST === '1'
  let browserInstance, browserPage
  const pageErrors = [], consoleErrors = []
  // Own one isolated browser and collect async failures before navigation.
  const browser = async (command, ...args) => {
    if (command === 'open') {
      browserInstance = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
      browserPage = await browserInstance.newPage({ viewport: { width: 1600, height: 1000 } })
      browserPage.on('pageerror', error => pageErrors.push(String(error.stack || error)))
      browserPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      return browserPage.goto(args[0])
    }
    if (command === 'close') return browserInstance?.close()
    if (command === 'wait') return args[0] === '--fn' ? browserPage.waitForFunction(args[1]) : browserPage.locator(args[0]).waitFor()
    if (command === 'eval') return browserPage.evaluate(args[0])
    if (command === 'snapshot') return browserPage.locator('body').innerText()
    if (command === 'errors') return pageErrors.join('\n')
    if (command === 'console') return consoleErrors.join('\n')
    if (command === 'fill') return browserPage.locator(args[0]).fill(args[1])
    if (command === 'select') return browserPage.locator(args[0]).selectOption(args[1])
    if (command === 'find') return args[0] === 'role' ? browserPage.getByRole(args[1], { name: args[4], exact: true }).click() : browserPage.getByText(args[1], { exact: true }).click()
    throw new Error(`Unsupported browser command: ${command}`)
  }
  try {
    const packageRoot = await packagePlugin(join(root, 'design-system'))
    await assert.rejects(packagePlugin(packageRoot), /EEXIST/)
    assert.ok(!(await readdir(packageRoot)).includes('node_modules'))
    const entry = join(packageRoot, 'scripts/design.mjs')
    const project = join(root, 'project')
    await new DesignProjectManager().create({ root: project, name: 'Portable fixture', kit: { name: 'web_app', version: '1.1' }, knowledge: { provider: 'ladybug-wasm' } })
    const statePath = join(project, 'design_files/smart_questions/smart_questions.json')
    await mkdir(join(project, 'design_files/smart_questions'))
    const state = { questions: { overview: { prompt: '目标是什么？', kind: 'text', answer: '可迁移的文件面板', detail: '' } } }
    await writeFile(statePath, JSON.stringify(state))
    // Empty cwd outside repository; bundled imports must resolve without node_modules.
    const options = { cwd: root, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } }
    // Execute the standalone Kit entry too: bundling design.mjs alone cannot
    // supply imports to scripts copied as static resources.
    const flowScripts = join(packageRoot, 'bundles/flow_design/scripts')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://dsh.local/flow">
<bpmn:process id="Process_P-001" isExecutable="false">
<bpmn:laneSet id="LaneSet_P-001_1">
<bpmn:lane id="Lane_P-001_Buyer" name="买家"><bpmn:flowNodeRef>StartEvent_P-001_1</bpmn:flowNodeRef><bpmn:flowNodeRef>UserTask_P-001_1</bpmn:flowNodeRef></bpmn:lane>
<bpmn:lane id="Lane_P-001_System" name="系统"><bpmn:flowNodeRef>ServiceTask_P-001_1</bpmn:flowNodeRef><bpmn:flowNodeRef>EndEvent_P-001_1</bpmn:flowNodeRef></bpmn:lane>
</bpmn:laneSet>
<bpmn:startEvent id="StartEvent_P-001_1"/><bpmn:userTask id="UserTask_P-001_1" name="提交订单"/>
<bpmn:serviceTask id="ServiceTask_P-001_1" name="保存订单"/><bpmn:endEvent id="EndEvent_P-001_1"/>
<bpmn:sequenceFlow id="SequenceFlow_P-001_1" sourceRef="StartEvent_P-001_1" targetRef="UserTask_P-001_1"/>
<bpmn:sequenceFlow id="SequenceFlow_P-001_2" sourceRef="UserTask_P-001_1" targetRef="ServiceTask_P-001_1"/>
<bpmn:sequenceFlow id="SequenceFlow_P-001_3" sourceRef="ServiceTask_P-001_1" targetRef="EndEvent_P-001_1"/>
</bpmn:process></bpmn:definitions>`
    const executeFlow = (script, args, input, scripts = flowScripts) => spawnSync(process.execPath, [join(scripts, script), ...args], {
      ...options, input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    })
    const laidOut = executeFlow('layout.mjs', [], xml)
    assert.equal(laidOut.status, 0, laidOut.stderr)
    assert.match(laidOut.stdout, /<bpmndi:BPMNShape/)
    assert.match(laidOut.stdout, /<bpmndi:BPMNEdge/)
    const imported = executeFlow('layout.mjs', ['--validate'], laidOut.stdout)
    assert.equal(imported.status, 0, imported.stderr)
    const checked = executeFlow('bpmn-validator.mjs', ['validate-final-bpmn-file'], JSON.stringify({
      process_id: 'P-001', process: { stakeholders: ['买家', '系统'], system_responsibilities: ['保存订单'],
        trigger_hints: [], key_features: [], business_rules: [], exception_handling: [] },
    }) + '\n' + laidOut.stdout)
    assert.equal(checked.status, 0, checked.stderr || checked.stdout)
    assert.equal(JSON.parse(checked.stdout).valid, true)
    const malformed = executeFlow('layout.mjs', ['--validate'], '<not-bpmn>')
    assert.notEqual(malformed.status, 0, 'bundled validator must actually parse its input')
    await mkdir(join(root, 'qoder'))
    const qoderPackage = await packagePlugin(join(root, 'qoder/design-system'), { host: 'qoder' })
    for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
      const expected = await readFile(new URL(`../../../${name}`, import.meta.url))
      for (const packaged of [packageRoot, qoderPackage]) for (const directory of [packaged, join(packaged, 'kits/web_app')]) {
        assert.deepEqual(await readFile(join(directory, name)), expected, `missing or stale own license material: ${name}`)
      }
    }
    const qoderScripts = join(qoderPackage, 'bundles/flow_design/scripts')
    const qoderLayout = executeFlow('layout.mjs', [], xml, qoderScripts)
    assert.equal(qoderLayout.status, 0, qoderLayout.stderr)
    assert.equal(qoderLayout.stdout, laidOut.stdout, 'both hosts publish the same layout implementation')
    const qoderImport = executeFlow('layout.mjs', ['--validate'], qoderLayout.stdout, qoderScripts)
    assert.equal(qoderImport.status, 0, qoderImport.stderr)
    const command = async input => JSON.parse((await run(process.execPath, [entry, 'command', '--input', input,
      '--thread', thread, '--projects-root', join(root, 'managed'), '--state-root', join(root, 'commands')], options)).stdout)
    const fresh = await command('new Portable new project')
    assert.equal(fresh.selected.kit, undefined)
    assert.equal((await command('mindset web_app')).selected.kit.name, 'web_app')
    const status = await command('status')
    assert.equal(status.selected.projectId, fresh.selected.projectId)
    assert.match(status.text, /未查询运行状态/)
    assert.equal((await command('close')).selected, undefined)
    assert.equal((await command(`open ${fresh.selected.root}`)).selected.projectId, fresh.selected.projectId)
    assert.equal((await command('delete Portable new project')).selected, undefined)
    assert.ok(await readFile(join(fresh.selected.root, 'project.json'), 'utf8'))
    const common = ['--project', project, '--state-root', join(root, 'journal')]
    const before = (await run('git', ['status', '--porcelain'], { cwd: project })).stdout
    const inspected = JSON.parse((await run(process.execPath, [entry, 'inspect', ...common], options)).stdout)
    assert.equal(inspected.kitRoot, join(packageRoot, 'kits/web_app'))
    assert.equal(inspected.bundles.find(x => x.name === 'smart_questions').hasState, true)
    assert.ok(inspected.bundles.length > 5)
    assert.equal(JSON.parse((await run(process.execPath, [entry, 'validate', ...common, '--skill', 'smart_questions'], options)).stdout).valid, true)
    assert.equal((await run('git', ['status', '--porcelain'], { cwd: project })).stdout, before, 'inspect/validate do not mutate project')
    await assert.rejects(run(process.execPath, [entry, 'serve', ...common, '--thread', 'latest'], options), /exact Codex thread/)
    const bin = join(root, 'bin')
    await mkdir(bin)
    const shim = join(bin, 'codex')
    await cp(fileURLToPath(new URL('./queue-stub.mjs', import.meta.url)), shim)
    await chmod(shim, 0o755)
    const queueFile = join(root, 'queue.jsonl')
    const transcriptPath = join(root, 'native.jsonl')
    await writeFile(transcriptPath, [
      { type: 'session_meta', payload: { id: thread, cwd: project } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1' } },
      { type: 'event_msg', payload: { type: 'item_completed', turn_id: 't1', item: { type: 'AgentMessage', id: 'm1', content: [{ type: 'Text', text: '打包会话消息' }] } } },
    ].map(value => JSON.stringify(value) + '\n').join(''))
    service = start(entry, ['serve', ...common, '--thread', thread, '--host-cwd', project, '--transcript', transcriptPath], {
      ...options, env: { ...options.env, PATH: `${bin}:${process.env.PATH}`, COMPANION_TEST_QUEUE_FILE: queueFile },
    })
    const ready = await service.ready
    // Use the actual packaged MCP declaration, with Codex's plugin-relative cwd.
    const mcpConfig = JSON.parse(await readFile(join(packageRoot, '.mcp.json'), 'utf8')).mcpServers['design-system']
    const mcp = new Client({ name: 'relocation-test', version: '1' })
    const mcpTransport = new StdioClientTransport({ ...mcpConfig, cwd: join(packageRoot, mcpConfig.cwd), env: options.env, stderr: 'pipe' })
    try {
      await mcp.connect(mcpTransport)
      // Pin the public tool surface, not just its count. Packaging must neither
      // lose existing project/review tools nor introduce additional authority.
      assert.deepEqual((await mcp.listTools()).tools.map(tool => tool.name).sort(), [
        'design_command', 'design_status', 'design_prepare_bundle',
        'design_knowledge_context', 'design_knowledge_status', 'design_refresh_knowledge',
        'design_query_knowledge', 'design_begin_main_bundle', 'design_finish_main_bundle',
        'design_register_run', 'design_finish_run', 'design_prepare_review',
        'design_recheck_reviews', 'design_bind_review', 'design_prepare_reviews',
        'design_read_review', 'design_bind_reviews', 'design_submit_review',
        'design_claim_action', 'design_settle_action',
      ].sort())
      const result = await mcp.callTool({ name: 'design_prepare_bundle', arguments: { connection: ready.connection, skill: 'smart_questions' } })
      assert.ok(!result.isError, JSON.stringify(result))
    } finally { await mcp.close(); await mcpTransport.close() }
    const url = new URL(ready.url)
    assert.equal(ready.thread, thread)
    const call = async (method, params) => {
      const response = await fetch(`${url.origin}/api`, { method: 'POST', headers: {
        Origin: url.origin, 'Content-Type': 'application/json', 'X-Design-Token': url.hash.slice(1),
      }, body: JSON.stringify({ method, params }) })
      assert.equal(response.status, 200)
      return response.json()
    }
    assert.match(await (await fetch(url.origin)).text(), /client.js/)
    assert.equal(await (await fetch(`${url.origin}/client.js`)).text(), await readFile(join(packageRoot, 'web/client.js'), 'utf8'))
    const observed = await call('readWorkspace')
    assert.deepEqual(observed.design.smart_questions.state, state)
    assert.equal(observed.conversation.available, true)
    assert.equal(observed.conversation.recordedStatus, 'completed')
    assert.equal(observed.conversation.rows[0].text, '打包会话消息')
    state.questions.overview.answer = '浏览器编辑后的事实'
    const saved = await call('savePanel', { skill: 'smart_questions', state, eventId: 'portable-save' })
    assert.ok(saved.commit)
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), state)
    const waitForKnowledge = async checkpoint => {
      let status
      for (let attempt = 0; attempt < 240; attempt += 1) {
        status = await call('knowledgeStatus')
        if (status.state === 'current' && status.head === checkpoint && status.latestComplete?.checkpoint === checkpoint) return status
        if (status.state === 'failed') break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      assert.fail(`KAG did not publish ${checkpoint}: ${JSON.stringify(status)}`)
    }
    // Panel publication automatically schedules KAG. Finish that publication
    // before the separate out-of-band Git edit below, so it cannot race this
    // test's explicit maintenance request for a different checkpoint.
    await waitForKnowledge(saved.commit)
    // Release gate: ship the projection-aware parser and annotated Kit together.
    // Reading the relocated package must not reintroduce system metadata nodes
    // or lose unresolved-reference diagnostics at the HTTP boundary.
    const pagePath = join(project, 'design_files/page_design/page_design.json')
    await mkdir(join(project, 'design_files/page_design'), { recursive: true })
    const pageBytes = JSON.stringify({ skill_name: 'page_design', schema_version: 7,
      page_order: ['p'], pages: { p: { id: 'p', name: 'Portable research', purpose: 'Read source evidence', parent_id: 'missing' } } })
    await writeFile(pagePath, pageBytes)
    await run('git', ['add', '--', 'design_files/page_design/page_design.json'], { cwd: project })
    await run('git', ['commit', '-m', 'fixture: published page evidence'], { cwd: project })
    // This direct Git edit bypasses Panel publication. Explicit maintenance
    // must publish its exact checkpoint before the relocated graph is queried.
    const headSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: project })).stdout.trim()
    const refreshed = await call('refreshKnowledge')
    assert.equal(refreshed.outcome, 'accepted', JSON.stringify(refreshed))
    assert.equal(refreshed.target?.checkpoint, headSha, JSON.stringify(refreshed))
    await waitForKnowledge(headSha)
    const graph = JSON.parse((await call('readGraph')).content)
    assert.equal(graph.knowledgeStatus,'current',graph.knowledgeError)
    // The published graph must be exactly at the committed checkpoint, not an
    // older publication misread as fresh.
    assert.equal(graph.checkpoint, headSha, JSON.stringify(graph.freshness))
    assert.equal(graph.freshness.indexedCheckpoint, graph.freshness.sourceCheckpoint, JSON.stringify(graph.freshness))
    assert.equal(graph.freshness.sourceCheckpoint, headSha, JSON.stringify(graph.freshness))
    assert.ok(graph.nodes.length)
    assert.ok(graph.nodes.some(node => node.file === 'page_design/page_design.json'))
    assert.equal(graph.nodes.some(node => /\/(schema_version|skill_name|page_order)(:|\/)/.test(node.context)), false)
    assert.ok(graph.warnings.some(warning => warning.includes('/pages/p/parent_id') && warning.includes('未在当前投影中解析')))
    assert.equal(await readFile(pagePath, 'utf8'), pageBytes)
    const pins={project:graph.projectId,checkpoint:graph.checkpoint,revision:graph.knowledgeRevision,limit:1,offset:0}
    const queried=await call('queryKnowledge',pins)
    assert.equal(queried.revision,graph.knowledgeRevision)
    assert.equal(queried.entities.length,1)
    assert.equal((await call('knowledgeContext')).available,true)
    const review = await call('prepareReview', { profile: 'clarity' })
    assert.equal(review.status, 'prepared')
    assert.ok(review.schema && review.prompt)
    assert.equal((await call('prepareReview', { profile: 'grounding' })).status, 'prepared')
    assert.ok((await call('prepareBundle', { skill: 'smart_questions' })).skill)
    if (withBrowser) {
      await browser('open', ready.url)
      await browser('wait', '--fn', 'document.body.innerText.includes("浏览器编辑后的事实")')
      if (!process.env.COMPANION_GRAPH_ONLY) {
        console.log(await browser('snapshot', '-i'))
        // Desktop edit actions intentionally appear on card hover/focus.
        await browserPage.locator('[data-tip-id="tip_qa_edit_answer"]').locator('xpath=../..').hover()
        await browser('find', 'text', 'Edit', 'click')
        await browser('wait', '.dsh-design-dock textarea:not([data-testid="question-text-supplement"])')
        console.log(await browser('snapshot', '-i'))
        await browser('fill', '.dsh-design-dock textarea:not([data-testid="question-text-supplement"])', '打包浏览器编辑后的事实')
        await browser('find', 'role', 'button', 'click', '--name', 'Save and assess next step')
        await browser('wait', '--fn', 'document.body.innerText.includes("Codex 已将通知入队")')
        assert.equal(JSON.parse(await readFile(statePath, 'utf8')).questions.overview.answer, '打包浏览器编辑后的事实')
      }
      await browser('find', 'role', 'button', 'click', '--name', '关联图谱')
      await browser('eval', 'window.graphTestErrors=[];window.addEventListener("error",e=>window.graphTestErrors.push(String(e.error?.stack||e.message)));window.addEventListener("unhandledrejection",e=>window.graphTestErrors.push(String(e.reason?.stack||e.reason)));')
      const waitGraph = async label => {
        try { await browser('wait', '[data-layout-state=settled]') }
        catch (error) {
          const state = await browser('eval', 'JSON.stringify({errors:window.graphTestErrors,hidden:document.hidden,alerts:[...document.querySelectorAll("[role=alert]")].map(e=>e.textContent),layouts:[...document.querySelectorAll("[data-layout-state]")].map(e=>({...e.dataset})),text:document.body.innerText.slice(-1800)})')
          throw new Error(label + ': ' + state + '\n' + (await browser('errors')) + '\n' + (await browser('console')) + '\n' + error.message)
        }
      }
      await waitGraph('initial graph')
      for (const mode of ['stress', 'd3', 'ngraph', 'fcose']) {
        await browser('select', '[aria-label="图谱布局"]', mode)
        await waitGraph(mode)
        if (mode === 'd3' || mode === 'ngraph') assert.ok(Number(await browserPage.locator('[aria-label="三维关联图"]').getAttribute('data-layout-ticks')) > 0, mode + ' must actually iterate')
        const alerts = await browser('eval', 'JSON.stringify([...document.querySelectorAll("[role=alert]")].map(e=>e.textContent))')
        assert.ok(!alerts.includes('不可用'), alerts)
      }
      assert.equal(await readFile(pagePath, 'utf8'), pageBytes, 'graph interaction never rewrites design source')
      assert.deepEqual(pageErrors, [])
      if (process.env.COMPANION_GRAPH_ONLY) await call('sendPrompt', { text: '请查看浏览器编辑后的事实' })
    } else await call('sendPrompt', { text: '请查看刚保存的答案' })
    const calls = (await readFile(queueFile, 'utf8')).trim().split('\n').map(JSON.parse)
    // Automatic GRA may deliver its separate rule notice while the package
    // checks run. Every message must retain the exact native/project binding;
    // the user's saved-file notification must still occur exactly once.
    for (const args of calls) {
      assert.equal(args.length, 5)
      assert.deepEqual(args.slice(0, 4), ['queue', '--thread', thread, '--message'])
      assert.ok(args[4].includes(project))
    }
    const ruleNotices = calls.filter(args => args[4].includes('Background GRA rule notice;'))
    const userNotices = calls.filter(args => !args[4].includes('Background GRA rule notice;'))
    assert.equal(userNotices.length, 1)
    assert.match(userNotices[0][4], /浏览器编辑后的事实/)
    assert.match(userNotices[0][4], /<panel_save_context>/)
    assert.ok(ruleNotices.length <= (withBrowser && !process.env.COMPANION_GRAPH_ONLY ? 2 : 1))
    const noticeCheckpoints = ruleNotices.map(args => {
      assert.match(args[4], /Exact prepared review references:/)
      const checkpoint = args[4].match(/Published checkpoint: ([a-f0-9]{40,64})\./)?.[1]
      assert.ok(checkpoint)
      if (!withBrowser || process.env.COMPANION_GRAPH_ONLY) assert.equal(checkpoint, saved.commit)
      return checkpoint
    })
    assert.equal(new Set(noticeCheckpoints).size, noticeCheckpoints.length, 'no duplicate automatic delivery for one publication')
    service.child.kill('SIGTERM')
    assert.equal(await service.exited, 0)
    service = undefined
  } finally {
    if (withBrowser) await browser('close').catch(() => {})
    if (service) { service.child.kill('SIGTERM'); await service.exited }
    await rm(root, { recursive: true, force: true })
  }
})
