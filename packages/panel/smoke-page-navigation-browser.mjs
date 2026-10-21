/** Single-page migration slice. Never starts the user application or shared CDP. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { access, cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DesignFilesStore, GitVersioning, validatorFromSchemaYaml } from '../core/lib/index.js'
import { parsePanelManifest } from '../core/lib/panel-dsl.js'
import { checkPageWorkspaceActions } from './test/page-workspace-actions-browser.mjs'
import { installedVisualCli } from './installed-visual-cli.mjs'
const run = promisify(execFile), cwd = import.meta.dirname
const executable = process.env.PAGE_TEST_CHROMIUM
assert.ok(executable?.startsWith('/'), 'PAGE_TEST_CHROMIUM must be a preflighted absolute executable path')
await access(executable, constants.X_OK)
const output = await mkdtemp(join(tmpdir(), 'cx2-page-navigation-')), web = join(output, 'web'), project = join(output, 'project')
const session = `cx2-page-${process.pid}`
const deadline = new AbortController()
const timer = setTimeout(() => deadline.abort(new Error('150s internal test deadline')), 150000)
const browser = async (...args) => (await run('agent-browser', ['--session', session, '--executable-path', executable, ...args], { signal: args[0] === 'close' ? undefined : deadline.signal, timeout: args[0] === 'close' ? 10000 : 25000, maxBuffer: 2e6 })).stdout
const evalJS = script => browser('eval', '-b', Buffer.from(script).toString('base64'))
const clickText = text => browser('find', 'role', 'button', 'click', '--name', text, '--exact')
const clickHotspot = async () => {
  await browser('wait', '--fn', 'window.pageMessages?.some(e=>e.ownFrame && e.data?.probe === "image" && e.data.width > 0)')
  let ref
  for (let attempt = 0; attempt < 10 && !ref; attempt++) {
    const snapshot = await browser('snapshot', '-i')
    ref = snapshot.match(/button "Read detail" \[ref=(e\d+)\]/)?.[1]
    if (!ref) await browser('wait', '250')
  }
  assert.ok(ref, 'real iframe hotspot must appear in accessibility snapshot')
  await browser('click', '@' + ref)
}
const files = ['smoke-page-navigation-browser.mjs', 'test/web-app-browser.tsx', 'test/visual-browser.config.ts', 'test/navigation-flow-browser-probe.tsx', 'src/navigation-workspace.tsx', 'src/navigation-frame-node.tsx', 'src/navigation-preview.tsx', 'src/navigation-record-node.tsx', 'src/navigation-node-state.ts', 'src/use-navigation-stylesheet.ts', 'src/use-flow-container-fit.ts', 'src/visual-components.css', 'src/locales/en-US.json', 'src/locales/zh-CN.json', 'src/live-preview.tsx', 'src/preview-navigation.ts', '../skills-web-app/bundles/page_design/panel.yaml']
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(resolve(cwd, file))).digest('hex')])))
for (const file of ['test/page-workspace-actions-browser.mjs', 'src/navigation-workspace-projection.ts', 'src/navigation-layout.ts', 'src/navigation-edge.ts', 'src/navigation-map-edits.ts', 'src/navigation-frame-drag.ts', 'src/navigation-connection.ts', 'src/navigation-viewport.ts', 'src/panel-workspace.tsx', 'src/interpreter.ts', '../core/src/panel-dsl.ts', '../core/src/panel-i18n.ts']) {
  hashes[file] = createHash('sha256').update(await readFile(resolve(cwd, file))).digest('hex')
}
console.log(JSON.stringify({ output, session, hashes }))
let server
const metrics = []
const captureGeometry = async label => {
  const geometry = JSON.parse(await evalJS(`(() => {
    const map = document.querySelector('.dsh-navigation-map').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.dsh-navigation-map .react-flow__node')].map(node => ({ id: node.dataset.id, rect: node.getBoundingClientRect().toJSON() }));
    const thumbnails = [...document.querySelectorAll('.dsh-navigation-record-node')].flatMap(card => {
      const thumbnail = card.querySelector('.dsh-navigation-thumbnail'); if (!thumbnail) return [];
      const r = card.getBoundingClientRect(), t = thumbnail.getBoundingClientRect(), style = getComputedStyle(card), scale = r.width / card.offsetWidth;
      const innerLeft = r.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * scale;
      const innerRight = r.right - (parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)) * scale;
      return [{ card: r.toJSON(), thumbnail: t.toJSON(), innerLeft, innerRight, inside: t.left >= innerLeft - 1 && t.right <= innerRight + 1 && t.top >= r.top && t.bottom <= r.bottom }];
    });
    return { viewport: { width: innerWidth, height: innerHeight }, map: map.toJSON(), nodes, thumbnails,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      nodesInside: nodes.length === 2 && nodes.every(({ rect: r }) => r.width > 0 && r.height > 0 && r.left >= map.left && r.right <= map.right && r.top >= map.top && r.bottom <= map.bottom) };
  })()`))
  metrics.push({ label, ...geometry })
  assert.equal(geometry.nodesInside, true, `${label}: every node must be inside the visible map`)
  assert.ok(geometry.thumbnails.every(item => item.inside), `${label}: thumbnail must fit inside card content bounds`)
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 2, `${label}: no document overflow`)
}
try {
  // Preserve real source bytes before compiling. A hash alone cannot reproduce
  // uncommitted worktree inputs after the next implementation slice changes them.
  const repository = resolve(cwd, '../..'), inputs = join(output, 'inputs')
  const inputPaths = ['packages/panel/src', 'packages/panel/test', 'packages/panel/package.json',
    'packages/panel/tsdown.config.ts', 'packages/panel/smoke-page-navigation-browser.mjs',
    'packages/core/src', 'packages/core/lib', 'packages/core/package.json',
    'packages/provider-web-app/src', 'packages/provider-web-app/tsdown.config.ts', 'packages/provider-web-app/package.json',
    'packages/skills-web-app/bundles/page_design', 'scripts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
  for (const path of inputPaths) await cp(join(repository, path), join(inputs, path), { recursive: true })
  for (const [path, hash] of Object.entries(hashes)) {
    const copied = resolve(inputs, 'packages/panel', path)
    assert.equal(createHash('sha256').update(await readFile(copied)).digest('hex'), hash, `snapshot must match launch input: ${path}`)
  }
  await writeFile(join(inputs, 'runtime.json'), JSON.stringify({ node: process.version, platform: process.platform,
    architecture: process.arch, executable, hashes }, null, 2))
  await mkdir(project, { recursive: true })
  const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return; throw e } },
    writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }, ensureDir: path => mkdir(path, { recursive: true }) }
  const spawn = async ({ argv, cwd, env }) => { try { return { exitCode: 0, ...await run(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } }) } } catch (e) { return { exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } } }
  const git = new GitVersioning(spawn, project); await git.ensureRepo()
  const store = new DesignFilesStore(fs, git, project)
  const panelDocument = parsePanelManifest(await readFile(resolve(cwd, '../skills-web-app/bundles/page_design/panel.yaml'), 'utf8'))
  if (panelDocument.i18n) {
    panelDocument.i18n.messages = {}
    for (const [locale, path] of Object.entries(panelDocument.i18n.locales)) panelDocument.i18n.messages[locale] =
      JSON.parse(await readFile(resolve(cwd, '../skills-web-app/bundles/page_design', path), 'utf8'))
  }
  const panel = JSON.stringify(panelDocument)
  const validate = validatorFromSchemaYaml(await readFile(resolve(cwd, '../skills-web-app/bundles/page_design/schema.yaml'), 'utf8'))
  const state = { schema_version: 7, stage: 'completed', pages: {
    a: { id: 'a', name: 'List', purpose: 'Choose a record', artifact_file: 'page_design/pages/a.html' },
    b: { id: 'b', name: 'Detail', purpose: 'Read selected record', artifact_file: 'page_design/pages/b.html' },
  }, page_order: ['a', 'b'], connections: { jump: { id: 'jump', label: 'Open detail', source_page_id: 'a', target_page_id: 'b' } }, connection_order: ['jump'], canvas_sections: {} }
  const editing = process.env.PAGE_TEST_MODE === 'editing'
  const parity = process.env.PAGE_TEST_MODE === 'parity'
  const thumbnails = process.env.PAGE_TEST_MODE === 'thumbnails'
  const grouping = process.env.PAGE_TEST_MODE === 'grouping'
  const frameControls = process.env.PAGE_TEST_MODE === 'frame-controls'
  const frameDrag = process.env.PAGE_TEST_MODE === 'frame-drag'
  const directions = process.env.PAGE_TEST_MODE === 'directions'
  const connections = process.env.PAGE_TEST_MODE === 'connections'
  const workspaceActions = process.env.PAGE_TEST_MODE === 'workspace-actions'
  if (connections) {
    state.pages.a.canvas_position = { x: 0, y: 0 }
    state.pages.b.canvas_position = { x: 500, y: 0 }
  }
  if (directions) {
    state.pages = Object.fromEntries(Object.entries({ center: [0, 0], north: [0, -600], east: [700, 0], south: [0, 600], west: [-700, 0] })
      .map(([id, [x, y]]) => [id, { id, name: id, purpose: `Navigate ${id}`, canvas_position: { x, y } }]))
    state.page_order = Object.keys(state.pages)
    state.connections = Object.fromEntries(['north', 'east', 'south', 'west'].map(id => [id,
      { id, label: `Go ${id}`, source_page_id: 'center', target_page_id: id }]))
    state.connection_order = Object.keys(state.connections)
  }
  if (grouping || frameControls || frameDrag) {
    delete state.canvas_sections
    state.common_spec = { layout: 'Shared', logo: { description: 'Example' }, shared_components: [],
      navigation: [{ id: 'work', label: 'Work', target_page_id: 'a', group: 'Work' }, { id: 'read', label: 'Read', target_page_id: 'b', group: 'Read' }] }
  }
  if (thumbnails) state.entry_page_ids = ['a']
  if (parity) Object.assign(state.connections.jump, { source_element_id: 'read', source_element_label: 'Read detail' })
  if (editing) {
    state.entry_page_ids = ['b']
    state.pages.a.parent_id = 'b'
    state.common_spec = { layout: 'Shared layout', logo: { description: 'Example logo' }, shared_components: ['Shared toolbar'], navigation: [{ id: 'detail', label: 'Detail', target_page_id: 'b' }] }
    state.canvas_sections = { section: { id: 'section', label: 'Group', page_ids: ['a', 'b'], canvas_position: { x: 0, y: 0 }, canvas_size: { width: 600, height: 300 } } }
  }
  const artifacts = { 'page_design/pages/a.html': '<!doctype html><html><body><img src="../assets/pixel.png" alt="Local image"><button data-prototype-id="read" data-prototype-label="Read detail">Read detail</button></body></html>',
    'page_design/pages/b.html': '<!doctype html><html><body><h1>Detail destination</h1></body></html>' }
  if (thumbnails || grouping || frameControls || frameDrag) {
    const shell = content => `<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;font:24px system-ui;background:#f4f6fa}
      header{height:96px;background:#25364c;color:white;padding:24px 40px;font-size:32px}
      main{display:grid;grid-template-columns:220px 1fr;min-height:620px}
      nav{padding:32px;background:#e2e8f0}article{padding:32px}h1{font-size:38px;margin:0 0 24px}
      section{background:white;border:2px solid #d0d8e3;padding:24px;margin-bottom:20px}
      button{font:inherit;padding:12px 24px;background:#e4edf8;border:2px solid #8ba5c7}
      img{width:32px;height:32px}
    </style></head><body><header>Research workspace — test fixture</header><main><nav>Library<br><br>Reading<br><br>Notes</nav><article>${content}</article></main></body></html>`
    artifacts['page_design/pages/a.html'] = shell('<h1>Reading list</h1><section><img src="../assets/pixel.png" alt="Local image"> Interface stability study<br><br><button data-prototype-id="read" data-prototype-label="Read detail">Read detail</button></section><section>Evidence review<br><br>Three papers selected for reading</section>')
    artifacts['page_design/pages/b.html'] = shell('<h1>Detail destination</h1><section>Interface stability study<br><br>Summary and evidence excerpts</section><section>Research notes<br><br>Compare the reported experimental conditions.</section>')
  }
  artifacts['page_design/pages/a-next.html'] = artifacts['page_design/pages/a.html']
  for (const path of Object.keys(artifacts)) artifacts[path] = artifacts[path].replace('../assets/pixel.png', '../../design_style/assets/pixel.png')
  for (const path of ['page_design/pages/a.html', 'page_design/pages/a-next.html']) artifacts[path] = artifacts[path].replace('</body>', '<script>document.addEventListener("click",e=>parent.postMessage({probe:"click",tag:e.target.tagName,text:e.target.textContent},"*"),true);document.querySelector("img").onload=e=>parent.postMessage({probe:"image",width:e.target.naturalWidth},"*");parent.postMessage({probe:"loaded"},"*")</script></body>')
  await store.write('page_design', state, { validate, artifacts, origin: 'panel', settleEvent: async () => {} })
  const stylePath = 'design_style/tokens.css'
  let css = 'body{color:rgb(12, 34, 56)}'
  // Test-owned Style artifact, not a Page panel write or a Style panel UI save.
  const styleFile = join(project, 'design_files', stylePath)
  await fs.writeText(styleFile, css)
  const inventory = () => Object.fromEntries([...Object.keys(artifacts), 'design_style/assets/pixel.png', stylePath].map(path => [path, path === stylePath ? createHash('sha256').update(css).digest('hex') : 'v1']))
  // Parser-time messages can belong to a document replaced during CSS/image
  // hydration. Also report on the existing full-preview onLoad handshake;
  // the parent still accepts only the currently mounted iframe's message.
  for (const path of Object.keys(artifacts)) artifacts[path] = artifacts[path].replace('</body>', '<script>function reportStyle(){parent.postMessage({probe:"computed-style",color:getComputedStyle(document.body).color},"*")}window.addEventListener("message",event=>{if(event.source===parent&&event.data?.type==="design-preview:variables")reportStyle()});reportStyle()</script></body>')
  const visualCli = installedVisualCli(cwd)
  await run(visualCli.command, visualCli.args, { cwd, signal: deadline.signal, env: { ...process.env, VISUAL_TEST_OUT: web, VISUAL_TEST_ENTRY: './web-app-browser.tsx', VISUAL_TEST_FLOW_PROBE: connections && process.env.PAGE_TEST_FLOW_PROBE === '1' ? '1' : '0' }, timeout: 90000, maxBuffer: 3e6 })
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<meta charset="utf-8"><div id="root"></div><script type="module" src="/fixture.js"></script>'); return }
      if (url.pathname === '/fixture') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ panel, state: await store.read('page_design'), artifactFiles: inventory() })); return }
      if (url.pathname === '/external-style' && req.method === 'POST') { css = 'body{color:rgb(65, 43, 21)}'; await fs.writeText(styleFile, css); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ artifactFiles: inventory() })); return }
      if (url.pathname === '/text-artifact') { const path = url.searchParams.get('path'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ found: path === stylePath || Object.hasOwn(artifacts, path), content: path === stylePath ? await readFile(styleFile, 'utf8') : artifacts[path] ?? '' })); return }
      if (url.pathname === '/artifact') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ found: url.searchParams.get('path') === 'design_style/assets/pixel.png', mediaType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', byteLength: 68 })); return }
      if (url.pathname === '/save' && req.method === 'POST') { let body = ''; for await (const part of req) body += part; const payload = JSON.parse(body); await store.write('page_design', payload.state, { validate, origin: 'panel', settleEvent: async () => {} }); res.end('ok'); return }
      const path = resolve(web, '.' + url.pathname)
      if (!path.startsWith(web + '/')) { res.writeHead(403).end(); return }
      res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(path))
    } catch (e) { res.writeHead(500).end(String(e)) }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${server.address().port}/?bundle=page_design`
  console.log(JSON.stringify({ url }))
  await browser('open', url)
  let checks
  if (frameControls) {
    await browser('set', 'viewport', '1400', '1000')
    await browser('wait', '.dsh-navigation-group-header input')
    const frame = '[data-id="frame:derived-group:0"]'
    const field = frame + ' .dsh-navigation-group-header input'
    assert.equal(JSON.parse(await evalJS('Object.hasOwn(window.declarativeTestDraft,"canvas_sections")')), false)
    await browser('fill', field, 'Cancelled')
    await browser('press', 'Escape')
    assert.equal(JSON.parse(await evalJS(`document.querySelector(${JSON.stringify(field)}).value`)), 'Work')
    assert.equal(JSON.parse(await evalJS('Object.hasOwn(window.declarativeTestDraft,"canvas_sections")')), false)
    await browser('fill', field, 'Header rename'); await browser('press', 'Enter')
    await browser('wait', '--fn', 'window.declarativeTestDraft.canvas_sections?.["derived-group:0"]?.label === "Header rename"')
    const initialFrames = JSON.parse(await evalJS('window.declarativeTestDraft.canvas_sections'))
    assert.equal(Object.keys(initialFrames).length, 2)
    const rectangle = JSON.parse(await evalJS(`document.querySelector(${JSON.stringify(frame)}).getBoundingClientRect().toJSON()`))
    // Select the frame's own padding, not the record card layered above it.
    await browser('mouse', 'move', String(Math.round(rectangle.x + 5)), String(Math.round(rectangle.y + 35)))
    await browser('mouse', 'down'); await browser('mouse', 'up')
    const handle = frame + ' .react-flow__resize-control.handle.bottom.right'
    await browser('wait', handle)
    const grip = JSON.parse(await evalJS(`document.querySelector(${JSON.stringify(handle)}).getBoundingClientRect().toJSON()`))
    const x = Math.round(grip.x + grip.width / 2), y = Math.round(grip.y + grip.height / 2)
    await browser('mouse', 'move', String(x), String(y)); await browser('mouse', 'down')
    await browser('mouse', 'move', String(x + 12), String(y + 12))
    await browser('mouse', 'move', String(x + 70), String(y + 45)); await browser('mouse', 'up')
    const resized = JSON.parse(await evalJS('window.declarativeTestDraft.canvas_sections'))
    const before = initialFrames['derived-group:0'], after = resized['derived-group:0']
    assert.ok(after.canvas_size.width > before.canvas_size.width + 30)
    assert.ok(after.canvas_size.height > before.canvas_size.height + 20)
    assert.deepEqual(after.page_ids, before.page_ids)
    assert.deepEqual(resized['derived-group:1'], initialFrames['derived-group:1'])
    metrics.push({ label: 'frame-resize', before, after })
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    assert.deepEqual((await store.read('page_design')).canvas_sections, resized)
    await browser('open', url); await browser('wait', field)
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft.canvas_sections')), resized)
    await browser('check', 'footer input[type=checkbox]')
    await browser('wait', '--fn', `document.querySelector(${JSON.stringify(field)})?.disabled === true`)
    assert.equal(JSON.parse(await evalJS(`document.querySelector(${JSON.stringify(field)}).disabled`)), true)
    assert.equal(JSON.parse(await evalJS('document.querySelectorAll(".react-flow__resize-control").length')), 0)
    await browser('uncheck', 'footer input[type=checkbox]')
    await browser('wait', '--fn', `document.querySelector(${JSON.stringify(field)})?.disabled === false`)
    await browser('click', frame + ' .dsh-navigation-group-header button')
    await browser('wait', '--fn', '!Object.hasOwn(window.declarativeTestDraft.canvas_sections,"derived-group:0")')
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    const saved = await store.read('page_design')
    assert.deepEqual(saved.pages, state.pages); assert.deepEqual(saved.connections, state.connections)
    assert.deepEqual(saved.common_spec, state.common_spec)
    assert.deepEqual(saved.canvas_sections, { 'derived-group:1': resized['derived-group:1'] })
    await browser('open', url); await browser('wait', '.dsh-navigation-group-header input')
    assert.equal(JSON.parse(await evalJS('document.querySelectorAll(".dsh-navigation-group-header").length')), 1)
    checks = ['header-escape-no-write', 'header-enter-full-materialization', 'real-frame-resize',
      'frame-resize-save-reopen', 'readonly-header-and-resizer', 'header-delete-preserves-records-and-artifacts', 'header-delete-save-reopen']
  } else if (workspaceActions) {
    checks = await checkPageWorkspaceActions({ browser, evalJS, clickText, store, url, metrics })
  } else if (connections) {
    await browser('set', 'viewport', '1400', '1000')
    // DOM cards may mount before React Flow has measured their handles. Observe
    // an existing rendered edge instead of mutating the store to force readiness.
    await browser('wait', '--fn', `(() => {
      const nodes = [...document.querySelectorAll('.react-flow__node-navigation-record')];
      const edge = document.querySelector('.react-flow__edge[data-id="jump"] .react-flow__edge-path');
      return nodes.length === 2 && nodes.every(node => {
        const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      }) && !!edge && edge.getTotalLength() > 0;
    })()`)
    metrics.push({ label: 'connection-readiness', observed: 'existing jump path and positive node dimensions',
      instrumented: process.env.PAGE_TEST_FLOW_PROBE === '1' })
    await evalJS(`(() => {
      window.connectionPointerEvents = [];
      for (const type of ['mousedown', 'mousemove', 'mouseup']) document.addEventListener(type, event => {
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        window.connectionPointerEvents.push({ type, x: event.clientX, y: event.clientY,
          node: hit?.closest('.react-flow__node')?.dataset.id, handle: hit?.dataset.handleid,
          classes: hit?.className, preview: !!document.querySelector('.react-flow__connection'),
          flow: window.pageFlowSnapshot?.() });
      }, true);
    })()`)
    const dragConnection = async (from, fromSide, to, toSide) => {
      const points = JSON.parse(await evalJS(`(() => {
        const center = selector => { const r = document.querySelector(selector).getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
        return { from: center('[data-id="node:${from}"] [data-handleid="source-${fromSide}"]'),
          to: center('[data-id="node:${to}"] [data-handleid="target-${toSide}"]') };
      })()`))
      metrics.push({ label: 'connection-pointer', source: from, target: to, points })
      metrics.push({ label: 'port-center-hits', source: from, target: to, hits: JSON.parse(await evalJS(`(() => {
        return Object.entries(${JSON.stringify(points)}).map(([end, point]) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return { end, node: hit?.closest('.react-flow__node')?.dataset.id,
            handle: hit?.dataset.handleid, classes: hit?.className };
        });
      })()`)) })
      await browser('mouse', 'move', String(points.from.x), String(points.from.y))
      await browser('mouse', 'down')
      await browser('mouse', 'move', String(points.from.x + 8), String(points.from.y + 8))
      await browser('mouse', 'move', String(points.to.x), String(points.to.y))
      await browser('mouse', 'up')
      // Flush the release handlers and their React render before reading state.
      await evalJS('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      assert.equal(JSON.parse(await evalJS('document.querySelector(".react-flow__connection") === null')), true,
        'connection gesture must finish before checking its effect')
    }
    const before = JSON.parse(await evalJS('window.declarativeTestDraft'))
    const artifactBytes = await Promise.all([before.pages.a.artifact_file, before.pages.b.artifact_file]
      .map(async path => [path, await readFile(join(project, path), 'utf8')]))
    await dragConnection('b', 'left', 'a', 'right')
    await browser('wait', '--fn', 'Object.keys(window.declarativeTestDraft.connections).length === 2')
    const added = JSON.parse(await evalJS('window.declarativeTestDraft'))
    assert.ok(Object.values(added.connections).some(edge => edge.source_page_id === 'b' && edge.target_page_id === 'a'))
    assert.deepEqual(added.pages, { ...before.pages, b: { ...before.pages.b, artifact_file: null } },
      'a new jump invalidates its source HTML only, matching the native Page panel')
    const editCount = JSON.parse(await evalJS('window.declarativeTestEditCount'))
    assert.ok(editCount > 0, 'the accepted gesture must reach the canonical edit callback')
    await dragConnection('a', 'right', 'b', 'left')
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft')), added, 'same-direction duplicate must not write')
    assert.equal(JSON.parse(await evalJS('window.declarativeTestEditCount')), editCount, 'duplicate must not invoke an edit callback')
    await dragConnection('a', 'right', 'a', 'left')
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft')), added, 'self-connection must not write')
    assert.equal(JSON.parse(await evalJS('window.declarativeTestEditCount')), editCount, 'self-connection must not invoke an edit callback')
    metrics.push({ label: 'connection-release-events', events: JSON.parse(await evalJS('window.connectionPointerEvents')) })
    metrics.push({ label: 'connection-store-observation', ...JSON.parse(await evalJS(`({
      callbacks: window.pageConnectionCallbacks ?? [], subscriptions: window.pageFlowEvents ?? [],
      snapshot: window.pageFlowSnapshot?.() ?? null
    })`)) })
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    const saved = await store.read('page_design')
    assert.deepEqual(saved, added, 'saving must preserve the complete accepted design state')
    for (const [path, content] of artifactBytes) {
      assert.equal(await readFile(join(project, path), 'utf8'), content,
        'invalidating a reference must retain the existing HTML file')
    }
    await browser('open', url)
    await browser('wait', '--fn', 'document.querySelectorAll(".react-flow__edge").length === 2')
    const reopened = JSON.parse(await evalJS('window.declarativeTestDraft'))
    assert.deepEqual(reopened, saved, 'reopening must restore the complete saved state')
    checks = ['real-pointer-reverse-connection', 'source-only-html-invalidation', 'duplicate-rejected-after-release',
      'self-connection-rejected-after-release', 'connection-pages-and-order-save-reopen', 'existing-html-files-retained']
  } else if (directions) {
    await browser('set', 'viewport', '1600', '1100')
    await browser('wait', '--fn', 'document.querySelectorAll(".react-flow__edge-path").length === 4')
    const geometry = JSON.parse(await evalJS(`(() => {
      const expected = { north: ['top', 'bottom'], east: ['right', 'left'], south: ['bottom', 'top'], west: ['left', 'right'] };
      return Object.entries(expected).map(([id, [source, target]]) => {
        const edge = document.querySelector('.react-flow__edge[data-id="' + id + '"]');
        const path = edge.querySelector('.react-flow__edge-path');
        const screen = length => { const point = path.getPointAtLength(length); return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()); };
        const handle = (node, kind, side) => {
          const rect = document.querySelector('[data-id="node:' + node + '"] [data-handleid="' + kind + '-' + side + '"]').getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        };
        const start = screen(0), end = screen(path.getTotalLength());
        const s = handle('center', 'source', source), t = handle(id, 'target', target);
        const label = edge.querySelector('.react-flow__edge-text').getBoundingClientRect();
        const overlaps = [...document.querySelectorAll('.react-flow__node-navigation-record')].some(node => {
          const r = node.getBoundingClientRect(); return label.left < r.right && label.right > r.left && label.top < r.bottom && label.bottom > r.top;
        });
        return { id, source, target, startDistance: Math.hypot(start.x - s.x, start.y - s.y),
          endDistance: Math.hypot(end.x - t.x, end.y - t.y), label: label.toJSON(), overlaps,
          hit: document.elementFromPoint(label.x + label.width / 2, label.y + label.height / 2)?.closest('.react-flow__edge')?.dataset.id };
      });
    })()`))
    metrics.push({ label: 'four-direction-routing', edges: geometry })
    assert.equal(geometry.length, 4)
    for (const edge of geometry) {
      assert.ok(edge.startDistance < 15 && edge.endDistance < 15, `${edge.id}: route must use the expected opposing handles`)
      assert.equal(edge.overlaps, false, `${edge.id}: label must not overlap a page card`)
      assert.equal(edge.hit, edge.id, `${edge.id}: label must remain selectable`)
    }
    await browser('screenshot', join(output, 'four-directions.png'))
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft')), state, 'view-only routing must not change canonical facts')
    checks = ['four-direction-opposing-handles', 'labels-outside-records', 'all-labels-selectable', 'routing-zero-canonical-writes']
  } else if (frameDrag) {
    await browser('set', 'viewport', '1400', '1000')
    await browser('wait', '--fn', 'document.querySelectorAll(".react-flow__node-navigation-frame").length === 2')
    // A vertical SVG stroke has a zero-width geometry box, so Playwright's
    // element visibility wait is not a valid readiness test. Actual visible
    // stroke hit-testing below remains required before and during dragging.
    await browser('wait', '--fn', 'Array.from(document.querySelectorAll(".react-flow__edge-path")).some(path => path.getTotalLength() > 0)')
    const visibleGraph = async label => {
      const visibility = JSON.parse(await evalJS(`(() => {
        const card = document.querySelector('[data-id="node:a"]'), rect = card.getBoundingClientRect();
        const edge = document.querySelector('.react-flow__edge'), path = edge?.querySelector('.react-flow__edge-path');
        return { member: document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 20)?.closest('.react-flow__node')?.dataset.id,
          edgeId: edge?.dataset.id, samples: path ? [0.15, 0.85].map(fraction => {
            const local = path.getPointAtLength(path.getTotalLength() * fraction);
            const screen = new DOMPoint(local.x, local.y).matrixTransform(path.getScreenCTM());
            return { fraction, x: screen.x, y: screen.y,
              hitEdge: document.elementFromPoint(screen.x, screen.y)?.closest('.react-flow__edge')?.dataset.id };
          }) : [] };
      })()`))
      metrics.push({ label, ...visibility })
      assert.equal(visibility.member, 'node:a', 'member card must be visible above its background frame')
      assert.ok(visibility.edgeId, 'canonical relation must have a rendered edge')
      assert.equal(visibility.samples.length, 2)
      assert.ok(visibility.samples.every(sample => sample.hitEdge === visibility.edgeId), 'both ends of the relation must remain hit-testable above frames')
    }
    await visibleGraph('before-drag-visibility')
    const rectangles = () => evalJS(`Object.fromEntries(['frame:derived-group:0','node:a','node:b'].map(id => [id,
      [...document.querySelectorAll('.react-flow__node')].find(node => node.dataset.id === id).getBoundingClientRect().toJSON()]))`)
    const before = JSON.parse(await rectangles())
    const beforeDraft = JSON.parse(await evalJS('window.declarativeTestDraft'))
    const frame = before['frame:derived-group:0']
    const x = Math.round(frame.x + 5), y = Math.round(frame.y + 35)
    // Record the actual hit and native event stream before the gesture. This
    // distinguishes stale fit coordinates, a blocked target and drag handling.
    const hit = JSON.parse(await evalJS(`(() => {
      const target = document.elementFromPoint(${x}, ${y});
      window.frameDragEvents = [];
      for (const type of ['mousedown', 'mousemove', 'mouseup']) document.addEventListener(type, event => {
        if (window.frameDragEvents.length < 40) window.frameDragEvents.push({ type, x: event.clientX, y: event.clientY,
          buttons: event.buttons, target: event.target?.className, node: event.target?.closest?.('.react-flow__node')?.dataset.id });
      }, true);
      return { x: ${x}, y: ${y}, target: target?.outerHTML.slice(0, 500),
        node: target?.closest('.react-flow__node')?.dataset.id,
        viewport: document.querySelector('.react-flow__viewport')?.style.transform };
    })()`))
    metrics.push({ label: 'frame-drag-start-hit', before, hit })
    assert.equal(hit.node, 'frame:derived-group:0', 'the real pointer must hit the intended frame')
    await browser('mouse', 'move', String(x), String(y)); await browser('mouse', 'down')
    await browser('mouse', 'move', String(x + 8), String(y + 2))
    await browser('mouse', 'move', String(x + 30), String(y + 15))
    await browser('wait', '--fn', 'Array.from(document.querySelectorAll(".react-flow__node")).some(node => node.dataset.id === "frame:derived-group:0" && node.classList.contains("dragging"))')
    await browser('mouse', 'move', String(x + 70), String(y + 40))
    const moving = JSON.parse(await rectangles())
    const dx = moving['frame:derived-group:0'].x - frame.x
    const dy = moving['frame:derived-group:0'].y - frame.y
    assert.ok(dx > 20 && dy > 10, 'the group must actually move before release')
    assert.ok(Math.abs(moving['node:a'].x - before['node:a'].x - dx) < 1, 'member follows horizontally before release')
    assert.ok(Math.abs(moving['node:a'].y - before['node:a'].y - dy) < 1, 'member follows vertically before release')
    assert.deepEqual(moving['node:b'], before['node:b'], 'other group member stays stationary')
    const visibleMember = JSON.parse(await evalJS(`(() => {
      const card = [...document.querySelectorAll('.react-flow__node')].find(node => node.dataset.id === 'node:a');
      const rect = card.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 20);
      return { node: hit?.closest('.react-flow__node')?.dataset.id,
        frameZ: getComputedStyle(document.querySelector('[data-id="frame:derived-group:0"]')).zIndex,
        cardZ: getComputedStyle(card).zIndex };
    })()`))
    metrics.push({ label: 'dragged-member-visibility', ...visibleMember })
    assert.equal(visibleMember.node, 'node:a', 'moving member must remain visible and hit-testable above its frame')
    await visibleGraph('during-drag-visibility')
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft')), beforeDraft, 'live feedback is not a canonical write')
    await browser('screenshot', join(output, 'frame-drag-before-release.png'))
    await browser('mouse', 'up')
    await browser('wait', '--fn', 'Object.keys(window.declarativeTestDraft.canvas_sections ?? {}).length === 2')
    const afterDraft = JSON.parse(await evalJS('window.declarativeTestDraft'))
    assert.equal(afterDraft.pages.a.artifact_file, beforeDraft.pages.a.artifact_file)
    assert.deepEqual(afterDraft.pages.b, beforeDraft.pages.b)
    assert.deepEqual(afterDraft.connections, beforeDraft.connections)
    assert.deepEqual(afterDraft.common_spec, beforeDraft.common_spec)
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    const saved = await store.read('page_design')
    assert.deepEqual(saved.pages.a.canvas_position, afterDraft.pages.a.canvas_position)
    assert.deepEqual(saved.canvas_sections, afterDraft.canvas_sections)
    await browser('open', url); await browser('wait', '.dsh-navigation-group-header input')
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft.canvas_sections')), saved.canvas_sections)
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft.pages.a.canvas_position')), saved.pages.a.canvas_position)
    metrics.push({ label: 'live-group-drag', before, moving, savedPosition: saved.pages.a.canvas_position })
    checks = ['live-frame-and-member-move', 'member-and-relation-visible-before-and-during-drag', 'other-members-stationary', 'no-write-before-release',
      'release-preserves-artifacts-and-relations', 'group-drag-save-reopen']
  } else if (grouping) {
    await browser('set', 'viewport', '1400', '1000')
    await browser('wait', '--fn', 'document.querySelectorAll(".react-flow__node-navigation-frame").length === 2 && document.querySelectorAll(".react-flow__edge-text").length === 1')
    assert.equal(JSON.parse(await evalJS('Object.hasOwn(window.declarativeTestDraft,"canvas_sections")')), false)
    const captureEdges = async label => {
      const value = JSON.parse(await evalJS(`(() => {
        const cards = [...document.querySelectorAll('.react-flow__node-navigation-record')].map(e=>e.getBoundingClientRect().toJSON());
        const labels = [...document.querySelectorAll('.react-flow__edge-text')].map(e=>e.getBoundingClientRect().toJSON());
        return {cards, labels, clear: labels.length === 1 && cards.length === 2 && labels.every(a=>cards.every(b=>a.right<=b.left || a.left>=b.right || a.bottom<=b.top || a.top>=b.bottom))};
      })()`))
      metrics.push({ label, ...value }); assert.equal(value.clear, true, 'edge label must not overlap record cards')
      await browser('screenshot', join(output, label + '.png'))
    }
    await captureEdges('grouping-before')
    const card = JSON.parse(await evalJS(`Array.from(document.querySelectorAll('.react-flow__node')).find(node => node.dataset.id === 'node:a').getBoundingClientRect().toJSON()`))
    const start = { x: Math.round(card.x + card.width / 2), y: Math.round(card.bottom - 16) }
    await browser('mouse', 'move', String(start.x), String(start.y))
    await browser('mouse', 'down')
    // First cross the drag threshold, then move the activated drag. A single
    // mousemove can only activate dragging and materialize the original point.
    await browser('mouse', 'move', String(start.x + 8), String(start.y + 2))
    await browser('mouse', 'move', String(start.x + 25), String(start.y + 5))
    await browser('wait', '--fn', 'Array.from(document.querySelectorAll(".react-flow__node")).some(node => node.dataset.id === "node:a" && node.classList.contains("dragging"))')
    await browser('mouse', 'move', String(start.x + 55), String(start.y + 10))
    await browser('mouse', 'up')
    await browser('wait', '--fn', '!!window.declarativeTestDraft.pages.a.canvas_position && Object.keys(window.declarativeTestDraft.canvas_sections ?? {}).length === 2')
    const dragged = JSON.parse(await evalJS('window.declarativeTestDraft.pages.a.canvas_position'))
    assert.ok(dragged.x > 20 && dragged.y > 0, 'drag must move beyond the initial derived origin, not just persist it')
    metrics.push({ label: 'actual-drag', from: { x: 0, y: 0 }, to: dragged })
    await clickText('Work')
    await browser('find', 'label', '名称', 'fill', 'Renamed group')
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    const saved = await store.read('page_design')
    assert.equal(Object.keys(saved.canvas_sections).length, 2)
    assert.ok(Object.values(saved.canvas_sections).some(frame => frame.label === 'Renamed group'))
    assert.deepEqual(saved.common_spec, state.common_spec)
    assert.equal(saved.pages.a.artifact_file, state.pages.a.artifact_file)
    assert.equal(saved.pages.b.artifact_file, state.pages.b.artifact_file)
    assert.deepEqual(saved.pages.a.canvas_position, dragged, 'save must retain the dragged point')
    await browser('open', url)
    await clickText('Renamed group')
    assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft.pages.a.canvas_position')), dragged,
      'reopened draft must retain the exact dragged point')
    await captureEdges('grouping-reopened')
    await browser('check', 'footer input[type=checkbox]')
    assert.equal(JSON.parse(await evalJS('document.querySelectorAll(".react-flow__node.draggable").length')), 0)
    await browser('uncheck', 'footer input[type=checkbox]')
    for (const frame of Object.values(saved.canvas_sections)) {
      await clickText(frame.label)
      await browser('click', `[data-testid="record-remove-${frame.id}"]`)
    }
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    assert.deepEqual((await store.read('page_design')).canvas_sections, {})
    await browser('open', url)
    await browser('wait', '.react-flow__node-navigation-record')
    assert.equal(JSON.parse(await evalJS('document.querySelectorAll(".react-flow__node-navigation-frame").length')), 0)
    checks = ['load-no-materialization', 'edge-label-clear', 'real-node-drag-materializes-all-frames', 'rename-save-reopen', 'layout-preserves-artifacts-and-navigation', 'readonly-no-drag', 'delete-all-frames-empty-survives-reopen']
  } else if (thumbnails) {
    await browser('set', 'viewport', '1100', '850')
    await browser('wait', '--fn', `(() => {
      const frames = [...document.querySelectorAll('.dsh-navigation-thumbnail iframe')];
      return frames.length === 2 && frames.every(frame => frame.srcdoc.includes('rgb(12, 34, 56)'))
        && frames.some(frame => frame.srcdoc.includes('data:image/png;base64,'))
        && frames.some(frame => frame.srcdoc.includes('Detail destination'));
    })()`)
    assert.equal(JSON.parse(await evalJS(`Array.from(document.querySelectorAll('.dsh-navigation-thumbnail iframe')).every(frame => frame.getAttribute('sandbox') === '' && frame.tabIndex === -1 && frame.srcdoc.includes("script-src 'none'"))`)), true)
    assert.equal(JSON.parse(await evalJS(`document.querySelector('.dsh-navigation-record-entry')?.textContent === '入口'`)), true)
    assert.equal(JSON.parse(await evalJS(`Array.from(document.querySelectorAll('.dsh-navigation-record-node [data-execution-status]')).filter(node => node.dataset.executionStatus === 'completed').length`)), 2)
    await captureGeometry('thumbnails-before')
    await browser('screenshot', join(output, 'thumbnails-before.png'))
    await clickText('模拟共享样式更新')
    await browser('wait', '--fn', `Array.from(document.querySelectorAll('.dsh-navigation-thumbnail iframe')).length === 2 && Array.from(document.querySelectorAll('.dsh-navigation-thumbnail iframe')).every(frame => frame.srcdoc.includes('rgb(65, 43, 21)'))`)
    assert.equal(JSON.parse(await evalJS(`(window.pageMessages ?? []).filter(event => event.data?.probe).length`)), 0, 'static thumbnails must not execute artifact probe scripts')
    await captureGeometry('thumbnails-after')
    await browser('screenshot', join(output, 'thumbnails-after.png'))
    assert.deepEqual(await store.read('page_design'), state, 'thumbnail reads and style refresh never edit canonical facts')
    checks = ['two-real-artifact-thumbnails', 'inline-local-image', 'shared-style-refresh', 'static-sandbox-no-artifact-script', 'entry-marker', 'file-backed-ready-status', 'canonical-unchanged']
  } else if (parity) {
    await clickText('Open detail')
    await browser('check', 'footer input[type=checkbox]')
    assert.equal(JSON.parse(await evalJS('Array.from(document.querySelectorAll("button")).some(b=>b.textContent === "解除元素绑定")')), false)
    await browser('uncheck', 'footer input[type=checkbox]')
    await clickText('解除元素绑定')
    await browser('wait', '--fn', '!window.declarativeTestDraft.connections.jump.source_element_id')
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    const saved = await store.read('page_design')
    assert.equal(saved.connections.jump.source_page_id, 'a')
    assert.equal(saved.connections.jump.target_page_id, 'b')
    assert.equal(saved.connections.jump.label, 'Open detail')
    assert.equal(saved.connections.jump.source_element_id, undefined)
    assert.equal(saved.connections.jump.source_element_label, undefined)
    await browser('open', url + '&locale=en-US'); await clickText('List')
    await browser('wait', '--fn', 'document.querySelector(".dsh-navigation-inspector").textContent.includes("Page name")')
    assert.equal(JSON.parse(await evalJS('document.body.textContent.includes("$t:")')), false)
    const allNodesVisible = `(() => {
      const map = document.querySelector('.dsh-navigation-map').getBoundingClientRect();
      const nodes = [...document.querySelectorAll('.dsh-navigation-map .react-flow__node')];
      return nodes.length === 2 && nodes.every(node => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= map.left && r.right <= map.right && r.top >= map.top && r.bottom <= map.bottom;
      });
    })()`
    await browser('set', 'viewport', '1100', '850')
    await browser('wait', '--fn', allNodesVisible)
    await captureGeometry('parity-wide')
    await browser('screenshot', join(output, 'wide-en.png'))
    await browser('set', 'viewport', '720', '850')
    await browser('wait', '--fn', 'document.querySelector(".dsh-navigation-inspector").getBoundingClientRect().top >= document.querySelector(".dsh-navigation-map").getBoundingClientRect().bottom - 2')
    assert.equal(JSON.parse(await evalJS('document.documentElement.scrollWidth <= innerWidth + 2')), true)
    await browser('wait', '--fn', allNodesVisible)
    await captureGeometry('parity-narrow')
    await browser('screenshot', join(output, 'narrow-en.png'))
    await browser('open', url); await clickText('Open detail')
    assert.equal(JSON.parse(await evalJS('Array.from(document.querySelectorAll("button")).some(b=>b.textContent === "解除元素绑定")')), false)
    checks = ['readonly-no-unbind', 'unbind-preserves-edge', 'unbind-save-reopen', 'english-panel-labels', 'no-unresolved-i18n', 'wide-layout', 'narrow-stacked-no-page-overflow']
  } else if (editing) {
    await clickText('List')
    await browser('find', 'label', '入口页面', 'check')
    await browser('wait', '--fn', 'window.declarativeTestDraft.entry_page_ids.includes("a")')
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    await browser('open', url); await clickText('List')
    assert.deepEqual((await store.read('page_design')).entry_page_ids, ['b', 'a'])
    await browser('find', 'label', '入口页面', 'click')
    await browser('wait', '--fn', '!window.declarativeTestDraft.entry_page_ids.includes("a") && !Array.from(document.querySelectorAll("label")).find(e=>e.textContent.trim()==="入口页面").querySelector("input").checked')
    await clickText('Detail')
    assert.equal(JSON.parse(await evalJS('Array.from(document.querySelectorAll("label")).find(e=>e.textContent.trim()==="入口页面").querySelector("input").disabled')), true)
    await browser('check', 'footer input[type=checkbox]')
    assert.equal(JSON.parse(await evalJS('document.querySelector("[data-testid=record-remove-b]") === null')), true)
    await browser('uncheck', 'footer input[type=checkbox]')
    await evalJS('window.confirm = () => false; true')
    await browser('click', '[data-testid=record-remove-b]')
    assert.equal(JSON.parse(await evalJS('Object.hasOwn(window.declarativeTestDraft.pages,"b")')), true)
    await evalJS('window.confirm = () => true; true')
    await browser('click', '[data-testid=record-remove-b]')
    await browser('wait', '--fn', '!Object.hasOwn(window.declarativeTestDraft.pages,"b")')
    await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
    const saved = await store.read('page_design')
    assert.deepEqual(saved.entry_page_ids, [])
    assert.deepEqual(saved.connections, {})
    assert.deepEqual(saved.connection_order, [])
    assert.deepEqual(saved.canvas_sections.section.page_ids, ['a'])
    assert.deepEqual(saved.common_spec.navigation, [])
    assert.equal(saved.pages.a.parent_id, undefined)
    assert.equal(saved.pages.a.artifact_file, null)
    assert.deepEqual(saved.common_spec.shared_components, ['Shared toolbar'])
    await browser('open', url); await clickText('List')
    assert.deepEqual(await store.read('page_design'), saved)
    checks = ['entry-edit-save-reopen', 'last-entry-toggle-guard', 'readonly-no-delete', 'cancel-no-delete', 'confirmed-delete', 'delete-reference-cleanup-save-reopen']
  } else {
  await clickText('Open detail'); await clickText('绑定预览中的元素')
  await browser('wait', '.dsh-live-preview iframe')
  await browser('wait', '--fn', 'window.pageMessages?.some(e=>e.ownFrame && e.data?.probe === "image" && e.data.width > 0)')
  await browser('wait', '--fn', 'window.pageMessages?.some(e=>e.ownFrame && e.data?.probe === "computed-style" && e.data.color === "rgb(12, 34, 56)")')
  await clickHotspot()
  await browser('wait', '--fn', 'window.declarativeTestDraft.connections.jump.source_element_id === "read"')
  await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  assert.equal((await store.read('page_design')).connections.jump.source_element_id, 'read')
  await browser('open', url); await clickText('List'); await clickText('内容预览')
  await browser('wait', '--fn', 'window.pageMessages?.some(e=>e.ownFrame && e.data?.probe === "computed-style" && e.data.color === "rgb(12, 34, 56)")')
  await evalJS('window.pageMessages = []; true')
  await clickText('模拟共享样式更新')
  await browser('wait', '--fn', 'window.pageMessages?.some(e=>e.ownFrame && e.data?.probe === "computed-style" && e.data.color === "rgb(65, 43, 21)")')
  await clickText('保存'); await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  assert.equal(await readFile(styleFile, 'utf8'), css, 'Page save must not modify shared Style artifact')
  await browser('open', url); await clickText('List'); await clickText('内容预览')
  await browser('wait', '--fn', 'window.pageMessages?.some(e=>e.ownFrame && e.data?.probe === "computed-style" && e.data.color === "rgb(65, 43, 21)")')
  await browser('wait', '.dsh-live-preview iframe'); await clickHotspot()
  await browser('wait', '--fn', 'document.querySelector(".dsh-navigation-preview header").textContent.includes("Detail")')
  await browser('wait', '.dsh-live-preview iframe')
  await evalJS('window.oldPreview = document.querySelector(".dsh-live-preview iframe"); true')
  await clickText('更新版本')
  await browser('wait', '--fn', 'document.querySelector(".dsh-live-preview iframe") && !window.oldPreview.isConnected && window.oldPreview !== document.querySelector(".dsh-live-preview iframe")')
  await clickText('Open detail'); await clickText('绑定预览中的元素')
  await browser('check', 'footer input[type=checkbox]')
  await browser('wait', '--fn', '!Array.from(document.querySelectorAll("button")).some(b=>b.textContent === "取消")')
  await browser('uncheck', 'footer input[type=checkbox]')
  await clickText('Open detail'); await clickText('绑定预览中的元素')
  await clickText('切换产物')
  await browser('wait', '--fn', '!Array.from(document.querySelectorAll("button")).some(b=>b.textContent === "取消")')
  await clickText('模拟外部删除目标')
  await browser('wait', '--fn', 'document.querySelector(".dsh-navigation-inspector [role=alert]") !== null')
  await clickHotspot()
  await browser('wait', '250')
  assert.ok((await evalJS('document.querySelector(".dsh-navigation-preview header").textContent')).includes('List'))
  assert.equal((await store.read('page_design')).connections.jump.source_element_id, 'read')
  await browser('screenshot', join(output, 'page.png'))
  checks = ['shared-image-natural-width', 'shared-css-computed-style', 'css-hash-update-computed-style', 'page-save-preserves-style', 'style-save-reopen', 'bind', 'save-reopen', 'navigate', 'revision-destroys-iframe', 'readonly-cancels-binding', 'artifact-path-cancels-binding', 'external-target-removal-prevents-navigation']
  }
  await browser('screenshot', join(output, 'page.png'))
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, hashes, url, executable, checks, metrics }, null, 2))
  console.log('PASS ' + output)
} catch (error) {
  let currentPreviewStyle
  try {
    await browser('frame', '.dsh-live-preview iframe')
    currentPreviewStyle = await evalJS('JSON.stringify({color:getComputedStyle(document.body).color,readyState:document.readyState,styles:Array.from(document.querySelectorAll("style[data-panel-preview-tokens]")).map(s=>s.textContent)})')
  } catch (inspectionError) { currentPreviewStyle = String(inspectionError) }
  await browser('frame', 'main').catch(() => {})
  await browser('screenshot', join(output, 'failure.png')).catch(() => {})
  const snapshot = await browser('snapshot', '-i').catch(() => '')
  const frames = await evalJS('JSON.stringify(Array.from(document.querySelectorAll("iframe")).map(f=>({title:f.title,connected:f.isConnected,src:f.src,sandbox:f.sandbox.value,rect:f.getBoundingClientRect().toJSON()})))').catch(() => '')
  const messages = await evalJS('JSON.stringify({messages:window.pageMessages,draft:window.declarativeTestDraft,srcdoc:document.querySelector(".dsh-live-preview iframe")?.srcdoc})').catch(() => '')
  const browserErrors = await browser('errors').catch(error => String(error))
  const browserConsole = await browser('console').catch(error => String(error))
  const graphDom = await evalJS(`(() => ({
    dragEvents: window.frameDragEvents,
    connectionEvents: window.connectionPointerEvents,
    flowState: window.pageFlowSnapshot?.(),
    flowEvents: window.pageFlowEvents,
    connectionCallbacks: window.pageConnectionCallbacks,
    nodes: [...document.querySelectorAll('.react-flow__node')].map(node => ({ id: node.dataset.id, rect: node.getBoundingClientRect().toJSON(),
      handles: [...node.querySelectorAll('.react-flow__handle')].map(handle => ({ id: handle.dataset.handleid, classes: handle.className, rect: handle.getBoundingClientRect().toJSON() })) })),
    edges: [...document.querySelectorAll('.react-flow__edge')].map(edge => ({ id: edge.dataset.id, html: edge.outerHTML })),
  }))()` ).catch(error => String(error))
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), hashes, snapshot, frames, messages, metrics, browserErrors, browserConsole, graphDom, currentPreviewStyle }, null, 2))
  throw error
} finally {
  clearTimeout(timer)
  await browser('close').catch(() => {})
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
}
