import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, access, cp, symlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { EXPORT_MANIFEST, inspectPublicSync, planPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'

const identity = value => ({ sha256: createHash('sha256').update(value).digest('hex'), mode: '100644' })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'public-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' })
  git(['init', '-q'])
  await writeFile(join(source, 'public.txt'), 'committed public text')
  await writeFile(join(source, 'private.txt'), 'private fixture')
  git(['add', '.'])
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  const revision = git(['rev-parse', 'HEAD']).trim()
  const policy = { version: 1, rules: [
    { kind: 'file', path: 'public.txt', action: 'include', reason: 'fixture' },
    { kind: 'file', path: 'private.txt', action: 'exclude', reason: 'fixture' },
  ] }
  return { source, revision, policy, root }
}

test('stage exports fixed committed bytes only, preserves sources, and writes deterministic provenance last', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source, 'public.txt'), 'dirty working bytes')
  const first = await stagePublicSnapshot({ ...f, destination: join(f.root, 'first') })
  const second = await stagePublicSnapshot({ ...f, destination: join(f.root, 'second') })
  assert.deepEqual(first.manifest, second.manifest)
  assert.equal(await readFile(join(first.target, 'public.txt'), 'utf8'), 'committed public text')
  assert.equal(await readFile(join(f.source, 'public.txt'), 'utf8'), 'dirty working bytes')
  await assert.rejects(access(join(first.target, 'private.txt')))
  assert.deepEqual(JSON.parse(await readFile(join(first.target, EXPORT_MANIFEST))), first.manifest)
  assert.equal(first.manifest.releaseApproved, false)
  await assert.rejects(stagePublicSnapshot({ ...f, destination: first.target }), { code: 'EEXIST' })
})

test('unreviewed input and source-descendant destinations are refused without a success marker', async t => {
  const f = await fixture(t)
  const destination = join(f.root, 'blocked')
  await assert.rejects(stagePublicSnapshot({ ...f, destination, policy: { version: 1, rules: [] } }), /review is incomplete/)
  await assert.rejects(access(destination))
  await assert.rejects(stagePublicSnapshot({ ...f, destination: join(f.source, 'nested') }), /outside source/)
  await assert.rejects(access(join(f.source, 'nested')))
})

async function documentFixture(t) {
  const f = await fixture(t)
  await mkdir(join(f.source, 'release'))
  await mkdir(join(f.source, 'docs'))
  await writeFile(join(f.source, 'docs', 'guide.md'), '# Guide\n')
  const drafts = { README: '# Public\n[Guide](../docs/guide.md#guide) [Contribute](CONTRIBUTING.public.md)\n',
    CONTRIBUTING: '# Contribute\n[Home](README.public.md)\n', SECURITY: '# Security\n[Home](README.public.md)\n' }
  for (const [name, text] of Object.entries(drafts)) {
    await writeFile(join(f.source, 'release', `${name}.public.md`), text)
    await writeFile(join(f.source, `${name}.md`), 'Internal root text\n')
    for (const path of [`release/${name}.public.md`, `${name}.md`]) f.policy.rules.push({ kind: 'file', path, action: 'include', reason: 'fixture reviewed document' })
  }
  f.policy.rules.push({ kind: 'file', path: 'docs/guide.md', action: 'include', reason: 'fixture public guide' })
  execFileSync('git', ['-C', f.source, 'add', '.'])
  execFileSync('git', ['-C', f.source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'public documents'])
  f.revision = execFileSync('git', ['-C', f.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return f
}

test('explicit public documents use fixed Git drafts, relocate links and record root replacements without publishing', async t => {
  const f = await documentFixture(t)
  await writeFile(join(f.source, 'release/README.public.md'), 'Dirty draft must not leak\n')
  const legacy = await stagePublicSnapshot({ ...f, destination: join(f.root, 'legacy-docs') })
  assert.equal(await readFile(join(legacy.target, 'README.md'), 'utf8'), 'Internal root text\n')
  assert.deepEqual(legacy.manifest.transforms, [])
  const result = await stagePublicSnapshot({ ...f, publicDocuments: true, destination: join(f.root, 'public-docs') })
  assert.equal(await readFile(join(result.target, 'README.md'), 'utf8'), '# Public\n[Guide](docs/guide.md#guide) [Contribute](CONTRIBUTING.md)\n')
  assert.equal(await readFile(join(result.target, 'CONTRIBUTING.md'), 'utf8'), '# Contribute\n[Home](README.md)\n')
  assert.equal(result.manifest.transforms.length, 3)
  for (const transform of result.manifest.transforms) {
    assert.equal(transform.kind, 'public-document-relocation')
    assert.match(transform.sourceOid, /^[a-f0-9]{40}$/u)
    assert.equal(transform.outputSHA256, result.manifest.files[transform.destination].sha256)
    assert.equal(transform.replacedSource.length, 1)
    assert.equal(transform.anchorsValidated, false)
    await assert.rejects(access(join(result.target, transform.origin)))
  }
  assert.equal(result.manifest.releaseApproved, false)
  assert.equal(result.targetCheckoutUpdated, false)
  const sync = await inspectPublicSync({ stageRoot: result.target, targetRoot: join(f.root, 'uncreated-public-checkout') })
  assert.equal(sync.applicable, true)
  await assert.rejects(access(sync.targetRoot))
})

test('public document link gaps or unreviewed drafts refuse staging before any output creation', async t => {
  const f = await documentFixture(t)
  for (const excluded of ['docs/guide.md', 'release/SECURITY.public.md']) {
    const policy = { ...f.policy, rules: f.policy.rules.map(rule => rule.path === excluded ? { ...rule, action: 'exclude' } : rule) }
    const destination = join(f.root, excluded.startsWith('docs/') ? 'missing-guide' : 'missing-draft')
    await assert.rejects(stagePublicSnapshot({ ...f, policy, destination, publicDocuments: true }), /links are not closed|drafts must be reviewed/)
    await assert.rejects(access(destination))
  }
  await assert.rejects(stagePublicSnapshot({ ...f, destination: join(f.root, 'invalid-option'), publicDocuments: 'true' }), /must be boolean/)
})

test('reading export provenance rejects fabricated approval and invalid document transformations without writing', async t => {
  const f = await documentFixture(t)
  const stage = await stagePublicSnapshot({ ...f, publicDocuments: true, destination: join(f.root, 'stage') })
  const target = join(f.root, 'untouched-target')
  const original = structuredClone(stage.manifest)
  const mutations = [
    manifest => { manifest.releaseApproved = true },
    manifest => { delete manifest.releaseApproved },
    manifest => { manifest.transforms = {} },
    manifest => { manifest.transforms.pop() },
    manifest => { manifest.transforms[0].destination = 'private.txt' },
    manifest => { manifest.transforms[0].origin = 'release/unknown.public.md' },
    manifest => { manifest.transforms[0].sourceOid = 'invalid' },
    manifest => { manifest.transforms[0].sourceSHA256 = 'invalid' },
    manifest => { manifest.transforms[0].outputSHA256 = '0'.repeat(64) },
    manifest => { manifest.transforms[0].anchorsValidated = true },
    manifest => { manifest.transforms[0].links[0].target = 'missing.md' },
    manifest => { manifest.transforms[0].replacedSource[0].path = 'private.txt' },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed)
    await writeFile(join(stage.target, EXPORT_MANIFEST), JSON.stringify(changed))
    await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /Invalid export provenance/)
    await assert.rejects(access(target))
  }
  await writeFile(join(stage.target, EXPORT_MANIFEST), JSON.stringify(original))
  assert.equal((await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })).applicable, true)
  // Old stages predate transformation records; they never claimed release approval.
  const legacy = await stagePublicSnapshot({ ...f, destination: join(f.root, 'legacy') })
  delete legacy.manifest.transforms
  await writeFile(join(legacy.target, EXPORT_MANIFEST), JSON.stringify(legacy.manifest))
  assert.equal((await inspectPublicSync({ stageRoot: legacy.target, targetRoot: target })).applicable, true)
})

test('document destination whitelist rejects an otherwise consistent relocated stage', async t => {
  const f = await documentFixture(t)
  const stage = await stagePublicSnapshot({ ...f, publicDocuments: true, destination: join(f.root, 'whitelist-stage') })
  const target = join(f.root, 'untouched-target')
  assert.equal((await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })).applicable, true)
  const names = { 'README.md': 'NOTICE.md', 'CONTRIBUTING.md': 'ABOUT.md', 'SECURITY.md': 'CHANGELOG.md' }
  const changed = structuredClone(stage.manifest)
  for (const [oldName, newName] of Object.entries(names)) {
    await rename(join(stage.target, oldName), join(stage.target, newName))
    changed.files[newName] = changed.files[oldName]
    delete changed.files[oldName]
  }
  for (const transform of changed.transforms) {
    transform.destination = names[transform.destination]
    transform.origin = `release/${transform.destination.slice(0, -3)}.public.md`
    for (const replaced of transform.replacedSource) replaced.path = transform.destination
    for (const link of transform.links) {
      if (!names[link.target]) continue
      const suffix = link.output.slice(link.output.split('#')[0].length)
      link.target = names[link.target]
      link.output = link.target + suffix
    }
  }
  await writeFile(join(stage.target, EXPORT_MANIFEST), JSON.stringify(changed))
  await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /Invalid export provenance/)
  await assert.rejects(access(target))
})

test('document links separately require an exported target and matching output path', async t => {
  const f = await documentFixture(t)
  const stage = await stagePublicSnapshot({ ...f, publicDocuments: true, destination: join(f.root, 'link-stage') })
  const target = join(f.root, 'untouched-target')
  assert.equal((await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })).applicable, true)
  const mutations = [
    manifest => { // Only target membership is invalid; output and target agree.
      manifest.transforms[0].links[0].target = 'missing.md'
      manifest.transforms[0].links[0].output = 'missing.md#guide'
    },
    manifest => { // Target exists; only the output/target correspondence is invalid.
      manifest.transforms[0].links[0].target = 'docs/guide.md'
      manifest.transforms[0].links[0].output = 'different.md#guide'
    },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(stage.manifest); mutate(changed)
    await writeFile(join(stage.target, EXPORT_MANIFEST), JSON.stringify(changed))
    await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /Invalid export provenance/)
    await assert.rejects(access(target))
  }
})

test('sync plan handles rename/delete/update and preserves unrelated content', () => {
  const previous = { 'old.txt': identity('old'), 'keep.txt': identity('keep'), 'edit.txt': identity('before') }
  const current = { ...previous, 'user.txt': identity('user') }
  const next = { 'new.txt': identity('old'), 'keep.txt': identity('keep'), 'edit.txt': identity('after') }
  const plan = planPublicSync({ previous, current, next })
  assert.equal(plan.applicable, true)
  assert.deepEqual(plan.deletes, ['old.txt'])
  assert.deepEqual(plan.writes, ['edit.txt', 'new.txt'])
  assert.deepEqual(plan.unchanged, ['keep.txt'])
  assert.equal(plan.targetUpdated, false)
  const repeated = planPublicSync({ previous: next, current: { ...next, 'user.txt': current['user.txt'] }, next })
  assert.deepEqual(repeated.writes, [])
  assert.deepEqual(repeated.deletes, [])
})

test('manual modification/removal, unmanaged overwrite and path boundaries block sync', () => {
  const previous = { 'file.txt': identity('original') }
  for (const current of [{}, { 'file.txt': identity('manual') }]) {
    assert.equal(planPublicSync({ previous, current, next: previous }).applicable, false)
  }
  assert.equal(planPublicSync({ current: previous, next: previous }).applicable, false)
  assert.equal(planPublicSync({ current: { a: identity('user') }, next: { 'a/b': identity('new') } }).applicable, false)
  assert.equal(planPublicSync({ current: { A: identity('user') }, next: { 'a/b': identity('new') } }).applicable, false)
  assert.equal(planPublicSync({ current: { 'A.txt': identity('user') }, next: { 'a.txt': identity('new') } }).applicable, false)
  for (const path of ['../escape', '.git/config', EXPORT_MANIFEST, 'a\\b', '/absolute']) {
    assert.throws(() => planPublicSync({ current: {}, next: { [path]: identity('bad') } }), /managed export path/)
  }
})

test('prototype-named source files retain explicit identity rather than changing manifest prototype', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source, '__proto__'), 'ordinary source file')
  execFileSync('git', ['-C', f.source, 'add', '__proto__'])
  execFileSync('git', ['-C', f.source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'prototype name'])
  const revision = execFileSync('git', ['-C', f.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  f.policy.rules.push({ kind: 'file', path: '__proto__', action: 'include', reason: 'fixture' })
  const result = await stagePublicSnapshot({ ...f, revision, destination: join(f.root, 'prototype-stage') })
  assert.equal(Object.hasOwn(result.manifest.files, '__proto__'), true)
  assert.deepEqual(result.manifest.files.__proto__, identity('ordinary source file'))
  assert.equal(Object.getPrototypeOf(result.manifest.files), Object.prototype)
})

test('indexed path boundaries preserve ancestor, descendant and case collision protection at scan scale', t => {
  const current = Object.fromEntries(Array.from({ length: 20000 }, (_, index) => [`retained/group-${index}/note.txt`, identity('retained')]))
  const next = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [`managed/file-${index}.txt`, identity('next')]))
  const started = performance.now()
  const clean = planPublicSync({ current, next })
  t.diagnostic(`20,000 current / 1,025 next entries: ${Math.round(performance.now() - started)}ms; timing is diagnostic, not a platform SLA`)
  assert.equal(clean.applicable, true)
  assert.equal(clean.writes.length, 1025)
  const cases = [
    [{ 'a/file': identity('old') }, { A: identity('new') }, 'boundary'],
    [{ A: identity('old') }, { 'a/file': identity('new') }, 'boundary'],
    [{ 'A.txt': identity('old') }, { 'a.txt': identity('new') }, 'case-colliding'],
    [{ 'somewhere/a/file': identity('old') }, { a: identity('new') }, null],
  ]
  for (const [present, output, kind] of cases) {
    const plan = planPublicSync({ current: present, next: output })
    assert.equal(plan.applicable, kind === null)
    if (kind) assert.ok(plan.conflicts.some(conflict => conflict.reason.includes(kind)))
  }
})

test('actual target scan preserves root Git and unmanaged files and detects manual edits without writing', async t => {
  const f = await fixture(t)
  const stage = await stagePublicSnapshot({ ...f, destination: join(f.root, 'stage') })
  const target = join(f.root, 'target')
  const initial = await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })
  assert.equal(initial.targetExists, false)
  assert.deepEqual(initial.writes, ['public.txt'])
  await assert.rejects(access(target), 'Inspection must not create its target')
  await cp(stage.target, target, { recursive: true })
  await mkdir(join(target, '.git'))
  await writeFile(join(target, '.git', 'private-git-metadata'), 'not traversed')
  await writeFile(join(target, 'user-notes.txt'), 'preserve this')
  const repeated = await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })
  assert.equal(repeated.applicable, true)
  assert.deepEqual(repeated.writes, [])
  assert.deepEqual(repeated.deletes, [])
  await writeFile(join(target, 'public.txt'), 'manual edit')
  const conflict = await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })
  assert.equal(conflict.applicable, false)
  assert.notEqual(conflict.targetStateSha256, repeated.targetStateSha256)
  assert.equal(await readFile(join(target, 'public.txt'), 'utf8'), 'manual edit')
  assert.equal(await readFile(join(target, 'user-notes.txt'), 'utf8'), 'preserve this')
})

test('actual scan rejects symlinks, incomplete or altered stage, malformed manifest, and overlapping roots', async t => {
  const f = await fixture(t)
  const stage = await stagePublicSnapshot({ ...f, destination: join(f.root, 'stage') })
  const target = join(f.root, 'target')
  await mkdir(target)
  await symlink(join(f.source, 'private.txt'), join(target, 'alias'))
  await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /symlinks/)
  await rm(join(target, 'alias'))
  await writeFile(join(stage.target, 'public.txt'), 'altered stage')
  await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /differ from their provenance/)
  await writeFile(join(stage.target, 'public.txt'), 'committed public text')
  await writeFile(join(target, EXPORT_MANIFEST), '{}')
  await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /Invalid export provenance/)
  await writeFile(join(target, EXPORT_MANIFEST), 'private invalid json <<<')
  await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), error => {
    assert.equal(error.message, 'Invalid export provenance manifest')
    return true
  })
  await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: join(stage.target, 'nested') }), /must not overlap/)
  await rm(join(stage.target, EXPORT_MANIFEST))
  await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /no completed provenance marker/)
})

async function sourceConfigFixture(t) {
  const f = await documentFixture(t)
  const content = {
    'package.json': JSON.stringify({ private: true, name: 'source', scripts: { build: 'pnpm -r build',
      'test:public-contracts': 'node --test scripts/public-test.mjs scripts/private-test.mjs', dogfood: './start.sh' }, repository: 'internal' }),
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'packages/core/package.json': JSON.stringify({ name: 'core', peerDependencies: { '@deepseek-ai/dsh-agent': '>=0.1.0-rc.5 <0.2.0' },
      devDependencies: { '@deepseek-ai/dsh-agent': 'link:../../deepseek-harness/packages/core/agent' } }),
    'packages/core/index.mjs': 'export {}\n',
    'packages/knowledge-ladybug/package.json': JSON.stringify({ name: 'knowledge', dependencies: { '@ladybugdb/wasm-core': 'file:../../vendor/ladybug/runtime' } }),
    'release/public-source-baseline.json': JSON.stringify({ kind: 'proposed-public-source-dependency-baseline', schemaVersion: 1,
      releaseApproved: false, registry: 'https://registry.npmjs.org', ladybugSource: 'registry', ladybugVersion: '0.21.1',
      officialVersions: { '@deepseek-ai/dsh-agent': '0.1.2-rc.1' }, rootScripts: ['build', 'test:public-contracts'], reviewedWorkspaceOverrides: {} }),
    'release/public-source-test-selection.json': JSON.stringify({ kind: 'proposed-public-source-root-test-selection', schemaVersion: 1,
      releaseApproved: false, rootScriptFileExclusions: { 'test:public-contracts': ['scripts/private-test.mjs'] } }),
    'scripts/public-test.mjs': 'export {}\n', 'scripts/private-test.mjs': 'export {}\n',
    'pnpm-lock.yaml': 'development-lock: preserved\n',
  }
  for (const [path, text] of Object.entries(content)) {
    await mkdir(join(f.source, path, '..'), { recursive: true })
    await writeFile(join(f.source, path), text)
    f.policy.rules.push({ kind: 'file', path, action: ['pnpm-lock.yaml', 'scripts/private-test.mjs'].includes(path) ? 'exclude' : 'include', reason: 'explicit fixture source decision' })
  }
  f.commit = () => {
    execFileSync('git', ['-C', f.source, 'add', '.'])
    execFileSync('git', ['-C', f.source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'source configuration'])
    f.revision = execFileSync('git', ['-C', f.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  }
  f.commit(); f.content = content
  return f
}

test('opt-in source config stages committed official selections and test exclusions with before/after identities', async t => {
  const f = await sourceConfigFixture(t)
  for (const path of ['package.json', 'pnpm-workspace.yaml', 'packages/core/package.json',
    'release/public-source-baseline.json', 'release/public-source-test-selection.json']) await writeFile(join(f.source, path), 'dirty cwd must not be used')
  const legacy = await stagePublicSnapshot({ ...f, destination: join(f.root, 'legacy-source') })
  assert.equal(await readFile(join(legacy.target, 'package.json'), 'utf8'), f.content['package.json'])
  assert.equal(legacy.manifest.sourceConfig, undefined)
  const stage = await stagePublicSnapshot({ ...f, publicSourceConfig: true, publicDocuments: true, destination: join(f.root, 'projected-source') })
  const root = JSON.parse(await readFile(join(stage.target, 'package.json'), 'utf8'))
  assert.deepEqual(root.scripts, { build: 'pnpm -r build', 'test:public-contracts': 'node --test scripts/public-test.mjs' })
  const core = JSON.parse(await readFile(join(stage.target, 'packages/core/package.json'), 'utf8'))
  assert.equal(core.devDependencies['@deepseek-ai/dsh-agent'], '0.1.2-rc.1')
  assert.equal(JSON.parse(await readFile(join(stage.target, 'packages/knowledge-ladybug/package.json'), 'utf8')).dependencies['@ladybugdb/wasm-core'], '0.21.1')
  assert.equal(stage.manifest.transforms.length, 3, 'document provenance remains separate and compatible')
  assert.equal(stage.manifest.sourceConfig.inputs.length, 2)
  assert.equal(stage.manifest.sourceConfig.files.length, 4, 'all source manifests and workspace survive projection')
  for (const file of stage.manifest.sourceConfig.files) {
    assert.equal(file.sourceSHA256, identity(f.content[file.path]).sha256)
    assert.equal(file.outputSHA256, stage.manifest.files[file.path].sha256)
    assert.match(file.sourceOid, /^[a-f0-9]{40}$/u)
  }
  assert.equal(stage.manifest.releaseApproved, false)
  assert.equal(stage.manifest.sourceConfig.lockAction, 'regenerate-in-isolated-source-candidate')
  assert.equal((await inspectPublicSync({ stageRoot: stage.target, targetRoot: join(f.root, 'untouched') })).applicable, true)
  assert.equal(await readFile(join(f.source, 'package.json'), 'utf8'), 'dirty cwd must not be used')
  assert.equal(await readFile(join(f.source, 'pnpm-lock.yaml'), 'utf8'), f.content['pnpm-lock.yaml'])
  await assert.rejects(access(join(stage.target, 'pnpm-lock.yaml')))
})

test('source config omits excluded packages while requiring manifests and dependency closure for retained content', async t => {
  const f = await sourceConfigFixture(t)
  const prefix = 'packages/internal-kit/'
  const files = {
    [prefix + 'package.json']: JSON.stringify({ name: 'internal-kit', dependencies: { privateSource: 'file:../../private-source' } }),
    [prefix + 'method.md']: 'Internal method must remain excluded\n',
  }
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(f.source, path, '..'), { recursive: true })
    await writeFile(join(f.source, path), text)
  }
  f.policy.rules.push({ kind: 'prefix', path: prefix, action: 'exclude', reason: 'Internal package is not public source' })
  const generatedManifestSource = 'packages/generated-host/build.mjs'
  const generatedSource = 'export function manifest() { return { name: "generated-host" } }\n'
  await mkdir(join(f.source, generatedManifestSource, '..'), { recursive: true })
  await writeFile(join(f.source, generatedManifestSource), generatedSource)
  f.policy.rules.push({ kind: 'file', path: generatedManifestSource, action: 'include', reason: 'Existing build generates its package manifest' })
  f.commit()
  const stage = await stagePublicSnapshot({ ...f, publicSourceConfig: true, destination: join(f.root, 'without-internal-kit') })
  for (const [path, text] of Object.entries(files)) {
    assert.equal(Object.hasOwn(stage.manifest.files, path), false)
    await assert.rejects(access(join(stage.target, path)), { code: 'ENOENT' })
    assert.equal(await readFile(join(f.source, path), 'utf8'), text)
  }
  assert.equal(stage.manifest.sourceConfig.files.some(file => file.path.startsWith(prefix)), false)
  assert.equal(await readFile(join(stage.target, generatedManifestSource), 'utf8'), generatedSource)
  assert.equal(stage.manifest.sourceConfig.files.some(file => file.path === 'packages/generated-host/package.json'), false)

  const policy = { ...f.policy, rules: [
    { kind: 'file', path: prefix + 'method.md', action: 'include', reason: 'Retained content requires its manifest' },
    ...f.policy.rules,
  ] }
  const missingManifest = join(f.root, 'retained-without-manifest')
  await assert.rejects(stagePublicSnapshot({ ...f, policy, publicSourceConfig: true, destination: missingManifest }), /inputs must all be reviewed/)
  await assert.rejects(access(missingManifest))

  const core = JSON.parse(f.content['packages/core/package.json'])
  core.dependencies = { 'internal-kit': 'workspace:*' }
  await writeFile(join(f.source, 'packages/core/package.json'), JSON.stringify(core))
  f.commit()
  const missingDependency = join(f.root, 'depends-on-excluded-kit')
  await assert.rejects(stagePublicSnapshot({ ...f, publicSourceConfig: true, destination: missingDependency }), /unresolved external local dependency internal-kit/)
  await assert.rejects(access(missingDependency))
})

test('source config projects private repository metadata before staging and still rejects other private content', async t => {
  const f = await sourceConfigFixture(t)
  const root = JSON.parse(f.content['package.json'])
  const privateHost = ['gitlab', 'alibaba-inc', 'com'].join('.')
  root.repository = { type: 'git', url: `https://${privateHost}/synthetic/source.git` }
  const original = JSON.stringify(root)
  await writeFile(join(f.source, 'package.json'), original)
  f.commit()
  const rejected = join(f.root, 'raw-private-source')
  await assert.rejects(stagePublicSnapshot({ ...f, destination: rejected }), /review is incomplete/)
  await assert.rejects(access(rejected))
  const stage = await stagePublicSnapshot({ ...f, publicSourceConfig: true, destination: join(f.root, 'safe-source') })
  const output = await readFile(join(stage.target, 'package.json'), 'utf8')
  assert.equal(Object.hasOwn(JSON.parse(output), 'repository'), false)
  assert.equal(output.includes(privateHost), false)
  assert.equal(await readFile(join(f.source, 'package.json'), 'utf8'), original)
  assert.equal(stage.manifest.sourceConfig.files.find(row => row.path === 'package.json').sourceSHA256, identity(original).sha256)
  root.description = `https://${privateHost}/synthetic/not-metadata.git`
  await writeFile(join(f.source, 'package.json'), JSON.stringify(root))
  f.commit()
  const unsafe = join(f.root, 'other-private-content')
  await assert.rejects(stagePublicSnapshot({ ...f, publicSourceConfig: true, destination: unsafe }), /review is incomplete/)
  await assert.rejects(access(unsafe))
})

test('source config refuses missing reviewed inputs, included development lock and invalid opt-in before creating output', async t => {
  const f = await sourceConfigFixture(t)
  for (const path of ['release/public-source-baseline.json', 'release/public-source-test-selection.json',
    'package.json', 'pnpm-workspace.yaml', 'packages/core/package.json']) {
    const policy = { ...f.policy, rules: f.policy.rules.map(rule => rule.path === path ? { ...rule, action: 'exclude' } : rule) }
    const destination = join(f.root, 'missing-' + path.replaceAll('/', '-'))
    await assert.rejects(stagePublicSnapshot({ ...f, policy, destination, publicSourceConfig: true }), /inputs must all be reviewed/)
    await assert.rejects(access(destination))
  }
  const policy = { ...f.policy, rules: f.policy.rules.map(rule => rule.path === 'pnpm-lock.yaml' ? { ...rule, action: 'include' } : rule) }
  const destination = join(f.root, 'old-lock')
  await assert.rejects(stagePublicSnapshot({ ...f, policy, destination, publicSourceConfig: true }), /excluded development lock/)
  await assert.rejects(access(destination))
  await assert.rejects(stagePublicSnapshot({ ...f, destination, publicSourceConfig: 'true' }), /must be boolean/)
})

test('source config rejects invalid committed proposal identities and fabricated stage provenance', async t => {
  const f = await sourceConfigFixture(t)
  const stage = await stagePublicSnapshot({ ...f, publicSourceConfig: true, destination: join(f.root, 'valid-source') })
  const original = structuredClone(stage.manifest), target = join(f.root, 'untouched')
  for (const mutate of [
    x => { x.sourceConfig.releaseApproved = true },
    x => { x.sourceConfig.inputs.pop() },
    x => { x.sourceConfig.inputs[0].sourceSHA256 = '0'.repeat(64) },
    x => { x.sourceConfig.inputs[0].sourceOid = 'invalid' },
    x => { x.sourceConfig.files[0].outputSHA256 = '0'.repeat(64) },
    x => { x.sourceConfig.files.pop() },
    x => { x.sourceConfig.files[0].path = 'private.txt' },
    x => { x.sourceConfig.lockAction = 'reuse-development-lock' },
  ]) {
    const manifest = structuredClone(original); mutate(manifest)
    await writeFile(join(stage.target, EXPORT_MANIFEST), JSON.stringify(manifest))
    await assert.rejects(inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), /Invalid export provenance/)
    await assert.rejects(access(target))
  }
  for (const [path, changes] of [
    ['release/public-source-baseline.json', { releaseApproved: true }],
    ['release/public-source-baseline.json', { kind: 'release-approved-config' }],
    ['release/public-source-test-selection.json', { releaseApproved: true }],
    ['release/public-source-test-selection.json', { kind: 'arbitrary-test-bypass' }],
  ]) {
    await writeFile(join(f.source, path), JSON.stringify({ ...JSON.parse(f.content[path]), ...changes }))
    f.commit()
    const destination = join(f.root, 'invalid-' + path.split('/').at(-1) + '-' + f.revision)
    await assert.rejects(stagePublicSnapshot({ ...f, publicSourceConfig: true, destination }), /Invalid public source baseline/)
    await assert.rejects(access(destination))
    await writeFile(join(f.source, path), f.content[path])
  }
})
