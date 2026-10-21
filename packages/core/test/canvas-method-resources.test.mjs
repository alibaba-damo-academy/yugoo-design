import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDesignKit } from '../src/kit-loader.ts'
import { reconstructionContractPrompt } from '../src/reconstruction-prompt.ts'
import { validatorFromSchemaYaml } from '../src/schema.ts'

const fs = {
  async readText(path) {
    try { return await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: realpath,
}

// Includes record_board's built-in mind map, not just components named "graph".
// This is the shipped-content inventory, not a runtime requirement for third-party Bundles.
const canvasComponents = new Set(['reference_graph', 'relation_graph', 'navigation_workspace',
  'diagram_workspace', 'canvas_workspace', 'record_board'])
function hasCanvas(value) {
  if (!value || typeof value !== 'object') return false
  return canvasComponents.has(value.component) || Object.values(value).some(hasCanvas)
}
function localLinks(markdown, from) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)]
    .map(match => match[1].split('#')[0])
    .filter(path => path && !/^[a-z][a-z\d+.-]*:/iu.test(path))
    .map(path => posix.normalize(posix.join(posix.dirname(from), path)))
}
function assertLoadedLink(resources, path) {
  assert.ok(!path.startsWith('../') && !path.startsWith('/'), `resource escapes Bundle: ${path}`)
  assert.equal(typeof resources[path], 'string', `missing loaded resource: ${path}`)
}

for (const directory of ['skills-web-app']) {
  test(`${directory}: canvas methods are reachable through ordinary and reconstruction entries`, async () => {
    const root = fileURLToPath(new URL(`../../${directory}/`, import.meta.url))
    const kit = await loadDesignKit(fs, root, { sourceId: `fixture:canvas-methods:${directory}` })
    let count = 0
    for (const skill of kit.skills) {
      if (!hasCanvas(skill.metadata.panelManifest?.ui)) continue
      count++
      const prefix = `${skill.name}/`
      const resources = Object.fromEntries(Object.entries(kit.resources)
        .filter(([path]) => path.startsWith(prefix)).map(([path, text]) => [path.slice(prefix.length), text]))
      const guide = 'reference/canvas-guide.md'
      const contract = 'reference/artifact-contract.md'
      assertLoadedLink(resources, guide)
      assertLoadedLink(resources, contract)
      assert.ok(localLinks(skill.content, 'SKILL.md').includes(guide), `${skill.name}: ordinary entry`)
      assert.ok(localLinks(resources[contract], contract).includes(guide), `${skill.name}: contract entry`)
      assert.ok(reconstructionContractPrompt(skill, kit.resources).includes(contract), `${skill.name}: actual reconstruction resource entry`)
      // The common entry can index specialized methods/scripts/examples, all from its own Bundle.
      for (const path of localLinks(resources[guide], guide)) assertLoadedLink(resources, path)
      const example = resources['reference/preview.json'] ?? resources['reference/example.json']
      if (example) assert.equal(validatorFromSchemaYaml(skill.metadata.schemaYaml)(JSON.parse(example)).ok, true,
        `${skill.name}: retained representative state still matches its schema`)
    }
    assert.equal(count, 7)
  })
}

test('resource verification rejects unresolved and escaping guide links', () => {
  const resources = { 'reference/format.md': 'Existing format contract' }
  assert.deepEqual(localLinks('[format](format.md#geometry)', 'reference/canvas-guide.md'), ['reference/format.md'])
  assertLoadedLink(resources, 'reference/format.md')
  assert.throws(() => assertLoadedLink(resources, 'reference/missing.md'), /missing loaded resource/u)
  assert.throws(() => assertLoadedLink(resources, '../other-bundle/format.md'), /escapes Bundle/u)
})
