import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { register } = await import('tsx/esm/api'); register()
const { compileDesignRelationVocabulary, parsePinnedDesignRelation, renderDesignRelationVocabulary, resolveDesignRelation } = await import('../src/design-relation-vocabulary.ts')
const { loadDesignKit } = await import('../src/kit-loader.ts')

const valid = `schema_version: 1
relations:
  - type: web_app:validates
    meaning: supports
    direction: forward
    label:
      zh: 验证
      en: Validates
    description:
      zh: A 的证据验证 B
      en: Evidence from A validates B
`

test('optional Kit relation extension compiles against an exact pin', () => {
  const first = compileDesignRelationVocabulary(valid, 'web_app', '1.0')
  const same = compileDesignRelationVocabulary(valid, 'web_app', '1.0')
  assert.equal(first.revision, same.revision)
  const resolved = resolveDesignRelation('web_app:validates', first)
  assert.deepEqual({...resolved,definitionDigest:undefined}, {
    relationType:'web_app:validates',meaning:'supports',direction:'forward',classification:'kit',
    vocabularyRevision:first.revision,kit:'web_app',kitVersion:'1.0',definitionDigest:undefined,
  })
  assert.match(resolved.definitionDigest,/^[0-9a-f]{64}$/)
  assert.match(renderDesignRelationVocabulary(first), /web_app:validates/)
  assert.doesNotMatch(renderDesignRelationVocabulary(first), /contains \(A structurally contains B/)
  assert.match(renderDesignRelationVocabulary(first), /structural contains relation is maintained only by file projection/)
  assert.equal(compileDesignRelationVocabulary(undefined, 'web_app', '1.0').relations.length, 0)
})

test('stored Core semantics remain readable after the live Core registry evolves', () => {
  const tuple = {
    relationType: 'supports', meaning: 'corroborates', direction: 'forward', classification: 'core',
    vocabularyRevision: `core-v1:${'a'.repeat(64)}`,
  }
  const stable = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry)
  const pinned = { ...tuple, definitionDigest: createHash('sha256').update(stable(tuple)).digest('hex') }
  assert.deepEqual(parsePinnedDesignRelation(pinned, 'supports'), pinned)
  assert.equal(parsePinnedDesignRelation({...pinned,meaning:'tampered'},'supports'),undefined)
})

test('relations.yaml confinement is proven before any optional relation bytes are read', async () => {
  let relationsRead = false
  const fs = {
    async realPath(path) { return path.endsWith('/relations.yaml') ? '/outside/relations.yaml' : path },
    async readText(path) {
      if (path.endsWith('/mindset.md')) return '---\nname: fixture_basis\nversion: "1.0"\n---\n\n<design_skills>\n- sample\n</design_skills>\n'
      if (path.endsWith('/relations.yaml')) { relationsRead = true; return valid }
      return undefined
    },
    async listDir() { return [] },
    async isDirectory() { return true },
  }
  await assert.rejects(loadDesignKit(fs, '/kit', {sourceId:'test:escape'}), /escapes Kit root/)
  assert.equal(relationsRead, false)
})

test('extensions cannot shadow Core, escape their Kit namespace, or change Core direction', () => {
  assert.throws(() => compileDesignRelationVocabulary(valid.replace('web_app:validates','other:validates'), 'web_app', '1.0'), /namespace/)
  assert.throws(() => compileDesignRelationVocabulary(valid.replace('web_app:validates','supports'), 'web_app', '1.0'), /namespace/)
  assert.throws(() => compileDesignRelationVocabulary(valid.replace('direction: forward','direction: symmetric'), 'web_app', '1.0'), /conflicts/)
  assert.throws(() => compileDesignRelationVocabulary(valid.replace('meaning: supports','meaning: invented'), 'web_app', '1.0'), /Core meaning or use the current Kit namespace/)
  assert.throws(() => compileDesignRelationVocabulary(valid.replace('meaning: supports','meaning: contains'), 'web_app', '1.0'), /projection-owned/)
  assert.throws(() => compileDesignRelationVocabulary(valid + '\nextra: true\n', 'web_app', '1.0'), /unsupported field/)
})

test('unknown fallback preserves raw type but never invents semantic direction', () => {
  const resolved = resolveDesignRelation('unregistered-domain-edge')
  assert.deepEqual({...resolved,definitionDigest:undefined}, {
    relationType:'unregistered-domain-edge',meaning:'unknown',direction:'unknown',classification:'unknown',
    vocabularyRevision:resolveDesignRelation('also-unknown').vocabularyRevision,definitionDigest:undefined,
  })
})

test('Kit loader treats relations.yaml as an optional typed root slot', async () => {
  const root = fileURLToPath(new URL('../../panel/fixtures/fixture-kit', import.meta.url))
  const fs = {
    readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    listDir: readdir,
    isDirectory: async path => (await stat(path)).isDirectory(),
    realPath: realpath,
  }
  const kit = await loadDesignKit(fs, root, {sourceId:'test:fixture'})
  assert.equal(kit.relationVocabulary.relations[0].type, 'fixture_basis:corroborates')
  assert.equal(resolveDesignRelation('fixture_basis:corroborates', kit.relationVocabulary).meaning, 'supports')
  assert.match(kit.ontologyContract.revision, /^ontology-v1:[0-9a-f]{64}$/)
})

test('optional ontology relation constraints are backwards compatible and fail closed', () => {
  const constrained = valid.replace('    description:\n      zh: A 的证据验证 B\n      en: Evidence from A validates B\n', `    description:\n      zh: A 的证据验证 B\n      en: Evidence from A validates B\n    domain: [web_app/source#/items]\n    range: [web_app/target#/items]\n    cardinality: { from: many, to: one }\n    reasoning: { impact: true, causal: false, transitive: false }\n    evidence: { minimum: explicit }\n`)
  const compiled = compileDesignRelationVocabulary(constrained, 'web_app', '1.0')
  assert.deepEqual(compiled.relations[0].domain, ['web_app/source#/items'])
  assert.deepEqual(compiled.relations[0].cardinality, { from: 'many', to: 'one' })
  assert.equal(compiled.relations[0].reasoning.impact, true)
  assert.throws(() => compileDesignRelationVocabulary(constrained.replace('web_app/source', 'other/source'), 'web_app', '1.0'), /ontology types must use/)
  assert.throws(() => compileDesignRelationVocabulary(constrained.replace('    evidence: { minimum: explicit }', '    inverse: web_app:missing'), 'web_app', '1.0'), /inverse .* is not registered/)
})
