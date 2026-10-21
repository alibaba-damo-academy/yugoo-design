import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, realpath, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createAdvisoryEvidence } from '../src/advisory-evidence.ts'
// Package-built Git owns its fixed worker URL; source aliases cannot move that worker.
import { GitVersioning, DesignProjectManager, nodeDesignProjectSpawn } from '../lib/index.js'
import { loadDesignKit, createDirectoryBundleResolver } from '../src/kit-loader.ts'

const signal = () => new AbortController().signal
test('review reads one immutable commit and exact version resources despite live edits and HEAD movement', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'advisory-pins-')); t.after(() => rm(temp, { recursive: true, force: true }))
  const root = join(temp, 'project')
  await new DesignProjectManager().create({ root, name: 'Pinned project', kit: { name: 'fixture', version: '1.0' }, knowledge: { provider: 'ladybug-wasm' } })
  const project = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))
  project.kit.bundles = { qualified_example: '1.1' }
  await writeFile(join(root, 'project.json'), JSON.stringify(project))
  const file = 'design_files/example/example.json'
  await mkdir(join(root, 'design_files/example'), { recursive: true })
  await writeFile(join(root, file), '{"title":"saved v1"}')
  const git = new GitVersioning(nodeDesignProjectSpawn, root)
  const commit = await git.commitExact('v1', new Map([[file, await readFile(join(root, file))], ['project.json', await readFile(join(root, 'project.json'))]]), await git.head())
  const kits = new Map(['1.0', '2.0'].map(version => [version, { name: 'fixture', version, resources: {}, skills: [
    { name: 'example', catalogName: 'qualified_example', version: version === '1.0' ? '1.1' : version, content: 'method ' + version, metadata: {} },
  ] }]))
  const bundles = new Map(['1.0', '2.0'].map(version => [kits.get(version).skills[0].version, { skill: kits.get(version).skills[0], resources: {
    'SKILL.md': 'full method ' + version, 'schema.yaml': 'schema ' + version,
  } }]))
  const input = { git, commit, projectId: project.id, signal: signal(), resolveKit: pin => kits.get(pin.version),
    resolveBundle: pin => { assert.equal(pin.name, 'qualified_example'); return bundles.get(pin.version) } }
  const preparationCalls = []
  const libraryGit = new GitVersioning(async () => {
    assert.fail('immutable evidence must use library Git, not launch an external Git subprocess')
  }, root, undefined, false, 'native')
  const evidence = await createAdvisoryEvidence({ ...input, git: {
    readBytesAt(...args) { preparationCalls.push(['readBytesAt', args[0], args[1]]); return libraryGit.readBytesAt(...args) },
    listPathsAt(...args) { preparationCalls.push(['listPathsAt', args[0]]); return libraryGit.listPathsAt(...args) },
  } })
  assert.deepEqual(preparationCalls, [['readBytesAt', commit, 'project.json'], ['listPathsAt', commit]],
    'preparation stays bounded to exact committed metadata and path discovery without CLI assumptions')
  await writeFile(join(root, file), '{"title":"uncommitted"}')
  await writeFile(join(root, 'project.json'), JSON.stringify({ ...project, kit: { name: 'fixture', version: '2.0' } }))
  await git.commitExact('v2', new Map([['project.json', await readFile(join(root, 'project.json'))], [file, Buffer.from('{"title":"saved v2"}')]]), await git.head())
  const old = await evidence.read(file, 0, 12000, signal())
  assert.equal(old.checkpoint, commit); assert.match(old.content, /saved v1/)
  assert.equal(evidence.resource('example', 'schema.yaml', 0, 12000, signal()).content, 'schema 1.0')
  const newer = await createAdvisoryEvidence({ ...input, commit: await git.head() })
  assert.equal(newer.resource('example', 'schema.yaml', 0, 12000, signal()).content, 'schema 2.0')
  assert.match(JSON.stringify(await evidence.search('saved', signal())), /saved v1/)
  for (const bad of ['/etc/passwd', '../project.json', '.git/config', 'design_files/../project.json', 'C:/x', 'HEAD:project.json']) {
    await assert.rejects(evidence.read(bad, 0, 12000, signal()))
  }
  await assert.rejects(createAdvisoryEvidence({ ...input, commit: 'HEAD' }), /full commit/)
  await assert.rejects(createAdvisoryEvidence({ ...input, projectId: 'wrong-project' }), /identity/)
  await assert.rejects(createAdvisoryEvidence({ ...input, resolveKit: () => undefined }), /exact committed Kit/)
  await assert.rejects(createAdvisoryEvidence({ ...input, resolveBundle: () => undefined }), /overridden Bundle/)
  assert.throws(() => evidence.resource('example', 'missing.md', 0, 12000, signal()), /unavailable/)
  assert.throws(() => evidence.resource('other', 'schema.yaml', 0, 12000, signal()), /unavailable/)
  assert.throws(() => evidence.resource('example', 'schema.yaml', 0, 12001, signal()), /max_chars/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(evidence.read(file, 0, 10, cancelled.signal))

  await symlink('/etc/passwd', join(root, 'design_files/example/escape'))
  const command = (...argv) => { const result = spawnSync('git', argv, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr) }
  command('add', 'design_files/example/escape'); command('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'fixture symlink')
  const linked = await createAdvisoryEvidence({ ...input, commit: await git.head() })
  await assert.rejects(linked.read('design_files/example/escape', 0, 12000, signal()), /not a regular file/)
})

test('legacy definition slots are labeled projections and missing references are explicit', async () => {
  const oid = 'a'.repeat(40)
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Legacy', createdAt: '2026-10-15T00:00:00.000Z',
    knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'fixture', version: '1.0' } }
  let observedPin
  const evidence = await createAdvisoryEvidence({ commit: oid, projectId: metadata.id, signal: signal(),
    git: { listPathsAt: async () => ['project.json'], readBytesAt: async () => Buffer.from(JSON.stringify(metadata)) },
    resolveKit: pin => { observedPin = pin; return { name: 'fixture', version: '1.0', resources: {}, skills: [
      { name: 'example', catalogName: 'qualified_example', version: '1.1', content: 'body only', metadata: { schemaDocument: { type: 'object' } } },
    ] } }, resolveBundle: () => undefined })
  assert.deepEqual(observedPin, metadata.kit)
  assert.equal(evidence.resource('example', 'schema.yaml', 0, 12000, signal()).representation, 'loaded-schema-projection')
  assert.equal(evidence.resource('example', 'SKILL.md', 0, 12000, signal()).representation, 'loaded-method-body-projection')
  assert.throws(() => evidence.resource('example', 'validation.yaml', 0, 12000, signal()), /unavailable/)
  assert.throws(() => evidence.resource('example', 'reference/unknown.md', 0, 12000, signal()), /unavailable/)
})

test('loaded schema and validation projections retain exact text and hashes without invented resources', async () => {
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Loaded definitions',
    createdAt: '2026-10-15T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'fixture', version: '1.0' } }
  const schema = 'type: object\r\n# Exact loaded schema text\r\n', validation = 'skill: example\n# Exact loaded validation text\n'
  const create = resolveBundle => createAdvisoryEvidence({ commit: 'a'.repeat(40), projectId: metadata.id, signal: signal(),
    git: { listPathsAt: async () => ['project.json'], readBytesAt: async () => Buffer.from(JSON.stringify(metadata)) },
    resolveKit: () => ({ name: 'fixture', version: '1.0', resources: {}, skills: [
      { name: 'example', version: '1.0', content: 'complete loaded method', metadata: {
        schemaYaml: schema, validationYaml: validation, schemaDocument: { type: 'object', title: 'Not the YAML text' },
      } },
    ] }), resolveBundle })
  const evidence = await create(() => undefined)
  for (const [path, text, representation] of [['schema.yaml', schema, 'loaded-schema-projection'],
    ['validation.yaml', validation, 'loaded-validation-projection']]) {
    const value = evidence.resource('example', path, 0, 12000, signal())
    assert.equal(value.content, text)
    assert.equal(value.representation, representation)
    assert.equal(value.sha256, createHash('sha256').update(text).digest('hex'))
    assert.ok(evidence.manifest.bundles[0].resources.some(resource => resource.path === path && resource.sha256 === value.sha256))
  }
  assert.throws(() => evidence.resource('example', 'reference/unavailable.md', 0, 12000, signal()), /unavailable/)
  assert.throws(() => evidence.resource('other', 'schema.yaml', 0, 12000, signal()), /unavailable/)
  const controller = new AbortController(); controller.abort()
  assert.throws(() => evidence.resource('example', 'validation.yaml', 0, 12000, controller.signal))
  const exact = await create(() => ({ skill: { name: 'example', version: '1.0' }, resources: {
    'schema.yaml': 'exact installed schema resource', 'validation.yaml': 'exact installed validation resource',
  } }))
  assert.equal(exact.resource('example', 'schema.yaml', 0, 12000, signal()).content, 'exact installed schema resource')
  assert.equal(exact.resource('example', 'validation.yaml', 0, 12000, signal()).representation, 'loaded-resource')
})

test('every loaded official Bundle retains manifest-listed exact method, schema and validation resources', async () => {
  const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
  const packageRoot = new URL('../../skills-web-app/', import.meta.url).pathname
  const resolver = createDirectoryBundleResolver(fs, [{ rootDir: join(packageRoot, 'bundles'), sourceId: 'readonly-resource-test' }])
  const content = new Map()
  const kit = await loadDesignKit(fs, packageRoot, { sourceId: 'readonly-resource-test', resolveBundle: async pin => {
    const bundle = await resolver(pin); content.set(pin.name, bundle); return bundle
  } })
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Exact official resources',
    createdAt: '2026-10-15T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: kit.name, version: kit.version } }
  const evidence = await createAdvisoryEvidence({ commit: 'a'.repeat(40), projectId: metadata.id, signal: signal(),
    git: { listPathsAt: async () => ['project.json'], readBytesAt: async () => Buffer.from(JSON.stringify(metadata)) },
    resolveKit: () => kit, resolveBundle: pin => content.get(pin.name) })
  assert.equal(evidence.manifest.bundles.length, kit.skills.length)
  for (const bundle of evidence.manifest.bundles) {
    for (const path of ['SKILL.md', 'schema.yaml', 'validation.yaml']) {
      const resource = evidence.resource(bundle.bindingKey, path, 0, 12000, signal())
      const exact = content.get(bundle.name).resources[path]
      assert.equal(resource.content, exact.slice(0, 12000))
      assert.equal(resource.sha256, createHash('sha256').update(exact).digest('hex'))
      assert.equal(resource.name, bundle.name)
      assert.equal(String(resource.version), String(bundle.version))
      assert.ok(bundle.resources.some(entry => entry.path === path && entry.sha256 === resource.sha256))
    }
  }
})
