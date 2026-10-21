/** Shared declarative browser + real schema/store/Git; isolated from native hosts. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { DesignFilesStore, GitVersioning, validatorFromSchemaYaml } from '../core/lib/index.js'
import { questionPanel, questionSchema, questionState } from '../core/test/fixtures/declarative-question.mjs'
import { graphManifest, matrixManifest, artifactManifest } from './test/fixtures/declarative-visuals.mjs'

const run = promisify(execFile), root = import.meta.dirname
const temporary = await mkdtemp(join(tmpdir(), 'declarative-visual-'))
const out = join(temporary, 'web'), project = join(temporary, 'project')
const session = `declarative-${process.pid}`
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], { timeout: 45000, maxBuffer: 2e6 })).stdout
const objectNode = id => `.react-flow__node[data-id=${JSON.stringify(`node:${encodeURIComponent(JSON.stringify(['objects', id]))}`)}]`
const states = {
  graph_fixture: { objects: { first: { title: 'First item', kind: 'item' }, second: { title: 'Second item', kind: 'item' } },
    relations: { review: { title: 'Review link', state: 'draft', participants: {
      p1: { object_ref: 'first', role: 'origin' }, p2: { object_ref: 'second', role: 'destination' },
    }, participant_order: ['p1', 'p2'] } }, properties: {}, structures: {} },
  questions_fixture: structuredClone(questionState),
  matrix_fixture: { tables: { sample: { title: 'Example table', cells: [
    { row: 'A', column: 'One', value: 'Original' }, { row: 'B', column: 'One', value: 'Sibling' },
  ] } } },
  artifact_fixture: { views: {
    slow: { title: 'Slow preview', file: 'artifact_fixture/slow.html' },
    current: { title: 'Current preview', file: 'artifact_fixture/current.html' },
    missing: { title: 'Missing preview', file: 'artifact_fixture/missing.html' },
  } },
}
const panels = Object.fromEntries(Object.entries({
  graph_fixture: graphManifest, questions_fixture: questionPanel,
  matrix_fixture: matrixManifest, artifact_fixture: artifactManifest,
}).map(([name, manifest]) => [name, JSON.stringify(manifest)]))
const labels = { graph_fixture: 'Graph fixture', questions_fixture: 'Question fixture', matrix_fixture: 'Matrix fixture', artifact_fixture: 'Artifact fixture' }
const string = { type: 'string' }, stringList = { type: 'array', items: string }
const records = properties => ({ type: 'map', value: { type: 'object', properties } })
const schemas = {
  graph_fixture: { type: 'object', properties: {
    objects: records({ title: string, kind: string, specializes: string }),
    relations: records({ title: string, state: string, participants: records({ object_ref: string, role: string }), participant_order: stringList }),
    properties: records({ title: string, object_ref: string }), structures: records({ title: string, object_refs: stringList }),
  } },
  questions_fixture: questionSchema,
  matrix_fixture: { type: 'object', properties: { tables: records({ title: string,
    cells: { type: 'array', items: { type: 'object', properties: { row: string, column: string, value: string } } } }) } },
  artifact_fixture: { type: 'object', properties: { views: records({ title: string, file: string }) } },
}
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, validatorFromSchemaYaml(JSON.stringify(schema))]))
const artifacts = {
  'artifact_fixture/slow.html': '<h1>Old slow preview</h1>',
  'artifact_fixture/current.html': '<h1>Current fixture preview</h1><script>window.untrustedPreview = true</script>',
}
const artifactFiles = Object.fromEntries([...Object.keys(artifacts), 'artifact_fixture/missing.html'].map(path => [path, 'fixture-revision']))
const execute = ({ argv, cwd, stdinData, env }) => new Promise((resolveResult, reject) => {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', reject); child.on('close', exitCode => resolveResult({ exitCode, stdout, stderr }))
  child.stdin.end(stdinData)
})
let server
try {
  await mkdir(project)
  const git = new GitVersioning(execute, project); await git.ensureRepo()
  const store = new DesignFilesStore({
    readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error } },
    writeText: writeFile, ensureDir: path => mkdir(path, { recursive: true }),
  }, git, project)
  await run('pnpm', ['--config.verify-deps-before-run=false', 'exec', 'tsdown', '--config', 'test/visual-browser.config.ts'], { cwd: root, env: { ...process.env, VISUAL_TEST_OUT: out }, maxBuffer: 3e6 })
  server = createServer(async (req, res) => {
    try {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/fixture.js"></script>'); return }
      if (req.url === '/fixture') {
        const current = structuredClone(states)
        for (const name of Object.keys(states)) current[name] = await store.read(name) ?? current[name]
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ states: current, panels, labels, initialName: 'graph_fixture', artifactFiles })); return
      }
      if (req.url.startsWith('/artifact?')) {
        const path = new URL(req.url, 'http://localhost').searchParams.get('path')
        if (path.endsWith('/slow.html')) await new Promise(resolve => setTimeout(resolve, 800))
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ found: Object.hasOwn(artifacts, path), content: artifacts[path] ?? '' })); return
      }
      if (req.url === '/save' && req.method === 'POST') {
        let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 1e6) throw new Error('too large') }
        const { name, state } = JSON.parse(text)
        if (!Object.hasOwn(states, name)) throw new Error('unknown fixture')
        await store.write(name, state, { validate: validators[name], origin: 'panel', settleEvent: async () => {} })
        res.end('saved'); return
      }
      const path = resolve(out, `.${req.url}`)
      if (!path.startsWith(`${out}/`)) throw new Error('invalid path')
      res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'text/javascript')
      res.end(await readFile(path))
    } catch (error) { res.writeHead(400); res.end(String(error)) }
  })
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady))
  const url = `http://127.0.0.1:${server.address().port}`
  const click = async name => {
    const selector = `button[aria-label=${JSON.stringify(name)}]`
    await browser('wait', selector); return browser('click', selector)
  }
  const check = async code => assert.equal((await browser('eval', code)).trim(), 'true', code)
  const save = async () => { await click('保存测试文件'); await browser('wait', '--fn', 'document.body.innerText.includes("已保存并通过校验")') }
  await browser('open', url); await browser('wait', '.react-flow__node')
  await check('document.querySelectorAll(".react-flow__node").length === 2 && document.querySelectorAll(".react-flow__edge-path").length === 1')
  await browser('click', '.react-flow__edge-interaction')
  await browser('fill', 'aside [data-field=title] input', 'Edited link')
  await check('window.visualTest.states.graph_fixture.relations.review.title === "Edited link" && Object.keys(window.visualTest.states.graph_fixture.objects).length === 2')
  await save()
  assert.equal((await store.read('graph_fixture')).relations.review.title, 'Edited link')
  await browser('open', url); await browser('wait', '.react-flow__node')
  await check('window.visualTest.states.graph_fixture.relations.review.title === "Edited link"')
  await browser('eval', 'window.beforeDrag = JSON.stringify(window.visualTest.states)')
  await browser('drag', objectNode('first'), objectNode('second'))
  await check('JSON.stringify(window.visualTest.states) === window.beforeDrag')
  await click('添加关系'); await browser('click', objectNode('first')); await browser('click', objectNode('second'))
  await check('Object.keys(window.visualTest.states.graph_fixture.relations).length === 2')
  await check('Object.values(window.visualTest.states.graph_fixture.relations).some(link => link.participants.p1.object_ref === "first" && link.participants.p2.object_ref === "second" && link.participant_order.join() === "p1,p2")')
  await save()
  assert.equal(Object.keys((await store.read('graph_fixture')).relations).length, 2)
  await click('Question fixture'); await browser('wait', '.dsh-standard-question-card')
  await browser('click', '[data-question-id=purpose] [data-testid=standard-question-edit]')
  await browser('fill', '[data-question-id=purpose] .dsh-standard-question-text', 'Saved browser answer')
  await check('window.visualTest.states.questions_fixture.questions.purpose.detail === "Fixture context remains separate from the answer."')
  await save()
  assert.equal((await store.read('questions_fixture')).questions.purpose.answer, 'Saved browser answer')
  await browser('open', url); await click('Question fixture')
  await check('document.querySelector("[data-question-id=purpose] .dsh-standard-question-result").textContent.includes("Saved browser answer")')
  await browser('check', 'input[type=checkbox]')
  await check('!document.querySelector(".dsh-standard-question-text")')
  await browser('uncheck', 'input[type=checkbox]')
  await browser('set', 'viewport', '620', '900')
  await check('document.documentElement.scrollWidth <= innerWidth + 1')
  await browser('set', 'viewport', '1280', '900')
  await click('Matrix fixture'); await browser('wait', 'input[aria-label="A / One"]')
  await browser('fill', 'input[aria-label="A / One"]', 'Edited cell')
  await check('window.visualTest.states.matrix_fixture.tables.sample.cells[1].value === "Sibling"')
  await save()
  assert.equal((await store.read('matrix_fixture')).tables.sample.cells[0].value, 'Edited cell')
  await browser('open', url); await click('Matrix fixture')
  await check('document.querySelector("input[aria-label=\\"A / One\\"]").value === "Edited cell"')
  await browser('check', 'input[type=checkbox]')
  await check('document.querySelector("input[aria-label=\\"A / One\\"]").readOnly')
  await click('Artifact fixture'); await click('Current preview')
  await browser('wait', '--fn', 'document.querySelector("iframe")?.srcdoc.includes("Current fixture preview")')
  await check(`document.querySelector("iframe").getAttribute("sandbox") === "" && document.querySelector("iframe").srcdoc.includes("script-src 'none'") && !window.untrustedPreview`)
  await click('Slow preview'); await click('Current preview')
  await browser('wait', '1000')
  await check('document.querySelector("iframe").srcdoc.includes("Current fixture preview") && !document.querySelector("iframe").srcdoc.includes("Old slow preview")')
  await click('Missing preview'); await browser('wait', '[role=alert]')
  await check('!document.querySelector("iframe")')
  const errors = await browser('errors'); assert.ok(!errors.includes('Error'), errors)
  console.log('DECLARATIVE VISUAL BROWSER PASS: synthetic graph edit/connect, view-only drag, question and matrix real store/Git save/reopen, readonly, narrow viewport, sandboxed artifacts, missing artifact and late-read isolation. Not native-host/model evidence.')
} catch (error) {
  console.error(await browser('get', 'text', 'body').catch(() => ''))
  console.error(await browser('errors').catch(() => ''))
  throw error
} finally {
  await browser('close').catch(() => {})
  if (server) { server.closeAllConnections(); await new Promise(resolveClosed => server.close(resolveClosed)) }
  await rm(temporary, { recursive: true, force: true })
}
