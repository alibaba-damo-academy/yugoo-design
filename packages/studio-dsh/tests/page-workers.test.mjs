/** Actual page string values retain the fixed image Worker scripts.
 * The independent loader gate still visits the whole page. This check neither
 * skips parent code nor proves Worker dispatch, pool behavior or Host execution. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readStaticPicaInput, inspectStaticPicaInput, analyzeStaticPicaWorker } from '../../../scripts/pica-static-worker-compiler.mjs'
import { analyzeStaticPicaAuxiliary } from '../../../scripts/pica-static-worker-adapter.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const hash = value => createHash('sha256').update(value).digest('hex')
const entry = await realpath(require.resolve('dsh-design-panel/sample-preview'))
const lib = dirname(entry), panelRequire = createRequire(join(dirname(lib), 'package.json'))
const canvasRequire = createRequire(panelRequire.resolve('@excalidraw/excalidraw'))
const inventory = JSON.parse(await readFile(join(lib, 'pica-static-workers-sample-preview.json'), 'utf8'))
assert.equal(inventory.version, 1)
assert.deepEqual(inventory.entries, ['sample-preview'])
assert.deepEqual(inventory.sources.map(item => item.manifest.kind).sort(), ['embedded', 'standalone'])
const page = await readFile(new URL('../lib/page-client.js', import.meta.url), 'utf8')
const files = await readdir(lib)

function actualStrings(chunk) {
  // These compiler markers locate an already fixed public input. They grant no
  // skip or proof authority; each extracted script is checked against pinned
  // upstream factories below, and the whole-page loader check remains strict.
  const headers = [...page.matchAll(/^\/\/#region [^\n]*$/gmu)].filter(match => match[0].endsWith('/' + chunk))
  assert.equal(headers.length, 1, 'Expected one public Panel dependency region: ' + chunk)
  const start = headers[0].index
  const ends = /\n[\t ]*\/\/#endregion/gu
  ends.lastIndex = start
  const end = ends.exec(page)?.index
  assert.ok(end > start, 'Missing public Panel region end')
  const parsed = parseSync(chunk, page.slice(start, end))
  assert.deepEqual(parsed.errors, [])
  const values = [], pending = [parsed.program]
  while (pending.length) {
    const node = pending.pop()
    if (node.type === 'Literal' && typeof node.value === 'string') values.push(node.value)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value.filter(child => child?.type))
      else if (value?.type) pending.push(value)
    }
  }
  return values
}

const checked = []
for (const item of inventory.sources) {
  const kind = item.manifest.kind, name = kind === 'standalone' ? 'pica' : 'image-blob-reduce'
  const input = await readStaticPicaInput({ kind, directory: dirname(canvasRequire.resolve(name + '/package.json')) })
  const retained = inspectStaticPicaInput(input)
  assert.deepEqual(item.manifest.retention, retained)
  assert.deepEqual(Object.keys(item.workers).sort(), ['auxiliary', 'probe', 'task'])
  const chunks = files.filter(file => kind === 'standalone' ? /^pica-[\w-]+\.js$/u.test(file) : /^image-blob-reduce\.esm-[\w-]+\.js$/u.test(file))
  assert.equal(chunks.length, 1, 'Expected one normal public image dependency chunk')
  const strings = actualStrings(chunks[0])
  for (const role of ['task', 'probe', 'auxiliary']) {
    const expected = item.workers[role]
    const matches = strings.filter(value => role === 'auxiliary'
      ? value === Buffer.from(expected.code, 'latin1').toString('base64') : hash(value) === expected.sha256)
    assert.equal(matches.length, 1, 'Missing or ambiguous actual page Worker: ' + kind + '/' + role)
    const code = role === 'auxiliary' ? Buffer.from(matches[0], 'base64').toString('latin1') : matches[0]
    const analysis = role === 'auxiliary' ? analyzeStaticPicaAuxiliary(code, { input }) : analyzeStaticPicaWorker(code, { role, input })
    assert.equal(analysis.sha256, expected.sha256)
    assert.equal(analysis.bytes, expected.bytes)
    checked.push({ kind, role, bytes: analysis.bytes, sha256: analysis.sha256 })
  }
}
console.log(JSON.stringify({ result: 'DSH STUDIO PAGE IMAGE WORKER STRINGS OK', pageSha256: hash(page), checked,
  dispatchOrPoolVerified: false, hostVerified: false }))
