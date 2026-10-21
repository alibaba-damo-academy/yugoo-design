import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const { register } = await import('tsx/esm/api')
register()
const { requireDesignFileRelativePath } = await import('../../core/src/design-file-path.ts')
const { registerDshProducerDesignTools } = await import('../../core/src/dsh-producer-design-tools.ts')
const { loadDesignKit } = await import('../../core/lib/kit-loader.js')
const temp = mkdtempSync(join(tmpdir(), 'page-file-contract-'))
const root = join(temp, 'design_files')
const script = join(temp, 'installed-page-design.mjs')
const source = fileURLToPath(new URL('../bundles/page_design/scripts/page-design.mjs', import.meta.url))
const pagePath = 'page_design/page_design.json', stylePath = 'design_style/design_style.json', cssPath = 'design_style/tokens.css'
const htmlPath = 'page_design/pages/home.html'
const state = { pages: { home: { id: 'home' }, detail: { id: 'detail' } },
  connections: { open: { id: 'open', source_page_id: 'home', target_page_id: 'detail' } },
  common_spec: { layout: 'shell', logo: { description: 'wordmark' }, shared_components: ['button'],
    navigation: [{ id: 'home', label: 'Home', target_page_id: 'home', icon_ref: 'search' }] } }
const style = { config: { icons: { search: { svg: '<svg></svg>' } } } }
const html = '<html><body><button data-prototype-id="open" data-prototype-label="Open" data-prototype-connection="open" data-prototype-page="detail">Open</button></body></html>'
const files = { [pagePath]: JSON.stringify(state), [stylePath]: JSON.stringify(style), [cssPath]: ':root{--ds-text:#111;}' }
function stdin(operation, context, content = html) {
  return spawnSync(process.execPath, [script, operation], { encoding: 'utf8', input: JSON.stringify(context) + '\n' + content })
}
function native(operation = 'validate-html-file', path = htmlPath) {
  return spawnSync(process.execPath, [script, operation, '--design-files', root, '--input-file', path, '--page-id', 'home'], { encoding: 'utf8' })
}
function write(path, bytes) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), bytes) }
function expect(result, code, pattern) {
  assert.equal(result.status, code, result.stdout + result.stderr)
  if (pattern) assert.match(result.stdout + result.stderr, pattern)
  return JSON.parse(result.stdout)
}
try {
  mkdirSync(root)
  copyFileSync(source, script) // proves the installed script has no repo/module dependency
  for (const [path, bytes] of Object.entries(files)) write(path, bytes)
  write(htmlPath, html)
  const context = { page_id: 'home', input_files: files }
  const good = expect(stdin('validate-html-file', context), 0)
  assert.deepEqual(expect(native(), 0), good)
  assert.deepEqual(good.bindings, { open: { elementId: 'open', label: 'Open' } })
  const map = expect(stdin('validate-map-file', { input_files: { [stylePath]: files[stylePath] } }, files[pagePath]), 0)
  assert.deepEqual(expect(native('validate-map-file', pagePath), 0), map)

  // Actual installed resource map and actual generic tool transport, not a
  // model-crafted envelope. No new permission or Bundle-specific Core logic.
  const kit = await loadDesignKit({
    async readText(path) { try { return readFileSync(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return undefined; throw e } },
    async listDir(path) { return readdirSync(path) },
    async isDirectory(path) { return statSync(path).isDirectory() },
  }, fileURLToPath(new URL('../', import.meta.url)), { sourceId: 'fixture:page-file-contract' })
  assert.equal(kit.version, '1.0')
  assert.equal(kit.skills.find(skill => skill.name === 'page_design').version, '1.0')
  const contract = kit.resources['page_design/reference/artifact-contract.md']
  assert.match(contract, /input_files/)
  const tools = new Map(), reads = []
  registerDshProducerDesignTools({ tools: { register(definition) { tools.set(definition.name, definition) } } }, {
    async read(path) { reads.push(path); return { encoding: 'utf8', content: readFileSync(join(root, path), 'utf8') } },
    async write() { throw new Error('validation must not write') },
  }, { async read(path) { return kit.resources['page_design/' + path] } }, 'user_continue', {}, () => [], {
    async run(path, args, input) {
      assert.equal(path, 'page-design.mjs')
      const result = spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status }
    },
  })
  const transported = await tools.get('run_skill_script').execute({ path: 'page-design.mjs', args: ['validate-html-file'],
    input_file: htmlPath, input_files: Object.keys(files), input_context: { page_id: 'home' } },
  { signal: new AbortController().signal })
  assert.equal(transported.exit_code, 0, transported.stderr)
  assert.deepEqual(JSON.parse(transported.stdout), good)
  assert.deepEqual(reads, [htmlPath, ...Object.keys(files)])

  // Real file wins over spoofed/transcription-damaged context (the live SVG failure).
  expect(stdin('validate-map-file', { input_files: files, style_authority: { icons: {} } }, files[pagePath]), 0)
  expect(stdin('validate-html-file', { ...context, state: {}, authoritative_tokens: {}, style_authority: {} }), 0)
  for (const path of Object.keys(files)) {
    const missing = { ...files }; delete missing[path]
    const result = expect(stdin('validate-html-file', { ...context, input_files: missing, state, style_authority: style.config }), 2, /missing required input_files/)
    assert.equal(result.kind, 'input_error')
  }
  expect(stdin('validate-html-file', { input_files: files }), 2, /page_id/)
  expect(stdin('validate-html-file', { ...context, input_files: { ...files, [pagePath]: '{broken' } }), 2)
  expect(stdin('validate-html-file', { ...context, input_files: { ...files, [cssPath]: '/* --ds-text: red; */' } }), 2, /no --ds/)
  expect(stdin('validate-map-file', { input_files: { [stylePath]: '{"config":{"icons":{}}}' } }, files[pagePath]), 1, /no SVG/)
  const tokenHtml = html.replace('<body>', '<body style="color:var(--ds-text)">')
  expect(stdin('validate-html-file', context, tokenHtml), 0)
  expect(stdin('validate-html-file', context, tokenHtml.replace('--ds-text', '--ds-unknown')), 1, /missing from the published set/)
  // A partial candidate is repaired in place; source changes invalidate old bindings.
  expect(stdin('validate-html-file', context, '<html><body>Pending</body></html>'), 1, /does not bind outgoing/)
  expect(stdin('validate-html-file', context, html), 0)
  const changed = structuredClone(state)
  changed.connections.next = { id: 'next', source_page_id: 'home', target_page_id: 'detail' }
  expect(stdin('validate-html-file', { ...context, input_files: { ...files, [pagePath]: JSON.stringify(changed) } }), 1, /next/)
  assert.equal(readFileSync(join(root, htmlPath), 'utf8'), html, 'validators never mutate artifacts')

  // Shared path corpus: native guard mirrors the public Core relative-path policy.
  for (const path of ['', '/', '/tmp/file', 'C:/file', 'a/', 'a\\b', 'a//b', './a', 'a/../b', 'a/.git/x', 'a\u0000b', 'a\u007fb', htmlPath, 'page_design/pages/页面.html']) {
    let accepted = true; try { requireDesignFileRelativePath(path) } catch { accepted = false }
    if (accepted) write(path, html)
    let nativeAccepted = false
    try { nativeAccepted = native('validate-html-file', path).status === 0 } catch (error) {
      // Node rejects NUL argv before the Bundle even receives it.
      assert.equal(error.code, 'ERR_INVALID_ARG_VALUE')
    }
    assert.equal(nativeAccepted, accepted, `Core/native path parity: ${JSON.stringify(path)}`)
  }
  const outside = join(temp, 'outside.html'); writeFileSync(outside, html)
  symlinkSync(outside, join(root, 'page_design/pages/escape.html'))
  expect(native('validate-html-file', 'page_design/pages/escape.html'), 2, /realpath escapes/)
  rmSync(join(root, stylePath)); symlinkSync(outside, join(root, stylePath))
  expect(native(), 2, /realpath escapes/)

  // Cross-Kit boundary: no Page semantics were added to transport/delegation.
  for (const name of ['dsh-producer-design-tools.ts', 'dsh-producer-delegation.ts']) {
    const text = readFileSync(new URL('../../core/src/' + name, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /page_design|style_authority|page_id/)
  }
  console.log('PAGE FILE CONTRACT: native/DSH parity, authority, recovery checks and confinement PASS')
} finally { rmSync(temp, { recursive: true, force: true }) }
