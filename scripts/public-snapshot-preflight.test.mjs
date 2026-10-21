import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { inspectPublicSnapshot } from './public-snapshot-preflight.mjs'

// Selection regressions use synthetic commits, not the five production binary
// blobs. Keep their actual selection rules without transplanting blob approvals.
// The dedicated exact-blob tests below still exercise strict approval binding.
function actualSelectionPolicy() {
  const actual = JSON.parse(readFileSync(new URL('../release/public-source-policy.json', import.meta.url), 'utf8'))
  return { version: actual.version, rules: actual.rules }
}

// fa488da classified these retained internal paths explicitly. Unknown siblings
// still require review; expected exclusions are named by each test, not inferred
// from the policy under test.
function assertNeighborActions(result, actualPolicy, neighbors, excluded) {
  for (const path of neighbors) {
    const action = excluded.includes(path) ? 'exclude' : 'review'
    assert.equal(result.entries.find(entry => entry.path === path).action, action, path)
    if (action === 'exclude') {
      const rules = actualPolicy.rules.filter(rule => rule.path === path)
      assert.equal(rules.length, 1, path)
      assert.equal(rules[0].kind, 'file', path)
      assert.equal(rules[0].action, 'exclude', path)
    }
  }
}

test('private root environment is explicitly excluded without reading credential bytes', t => {
  const actualPolicy = actualSelectionPolicy()
  const rules = actualPolicy.rules.filter(rule => rule.path === '.env')
  assert.equal(rules.length, 1)
  assert.equal(rules[0].kind, 'file')
  assert.equal(rules[0].action, 'exclude')
  const result = inspectPublicSnapshot({ ...fixture(t, {
    '.env': ['-----BEGIN', 'PRIVATE KEY-----\nSYNTHETIC ONLY\n'].join(' '),
    'unknown-file.txt': 'Unclassified synthetic input\n',
  }), policy: actualPolicy })
  const env = result.entries.find(entry => entry.path === '.env')
  assert.equal(env.action, 'exclude')
  assert.deepEqual(env.findings, [])
  assert.equal(result.entries.find(entry => entry.path === 'unknown-file.txt').action, 'review')
  assert.equal(result.releaseApproved, false)
})

test('explicit Ladybug selector selection binds actual reviewed source, not neighboring build approval', t => {
  const expected = {
    'scripts/companion-ladybug-dependency.mjs': '82c17535a1ed5cfb8ebc3524a9e66517956a6cac8c055cde0794355c852662ea',
    'scripts/companion-ladybug-dependency.test.mjs': '5fe3cd11fd7af093322066fb8b6f747ebdda279a0b2d344036463a2121df62ab',
  }
  const files = {}
  for (const [path, hash] of Object.entries(expected)) {
    const bytes = readFileSync(new URL('../' + path, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, path)
    files[path] = bytes
  }
  const neighbor = 'scripts/companion-ladybug-dependency-future.mjs'
  const builder = 'scripts/build-companion-npm-candidate.mjs'
  files[neighbor] = '// unreviewed future selector\n'
  files[builder] = '// source builder requires its own review\n'
  const actualPolicy = actualSelectionPolicy()
  // Exercise these two exact decisions independently; a later reviewed builder
  // rule is allowed without weakening this selection's no-prefix guarantee.
  const selectionPolicy = { version: actualPolicy.version, rules: actualPolicy.rules.filter(rule => Object.hasOwn(expected, rule.path)) }
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy: selectionPolicy })
  for (const path of Object.keys(expected)) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1, path)
    assert.equal(rules[0].kind, 'file', path)
    assert.equal(rules[0].action, 'include', path)
    const entry = result.entries.find(row => row.path === path)
    assert.equal(entry.action, 'include', path)
    assert.deepEqual(entry.findings, [], path)
  }
  for (const path of [neighbor, builder]) assert.equal(result.entries.find(row => row.path === path).action, 'review', path)
  assert.equal(result.classificationComplete, false)
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})

function fixture(t, files) {
  const source = mkdtempSync(join(tmpdir(), 'public-snapshot-test-'))
  t.after(() => rmSync(source, { recursive: true, force: true }))
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true })
    writeFileSync(join(source, path), value)
  }
  git(['add', '.'])
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  return { source, git, revision: git(['rev-parse', 'HEAD']).trim() }
}

test('hashed Slovak distribution assets do not suppress credentials in other fields or files', t => {
  // Assemble synthetic scanner input instead of embedding a credential-like
  // token in the publicly exported regression source itself.
  const asset = ['lib/sk', 'SK', 'C5VTKIMK', 'D_fPioTR.js'].join('-')
  const path = 'release/dsh-distribution-materials.json'
  const manifest = { schemaVersion: 1, packages: { panel: {
    observedOutputSha256: { [asset]: 'a'.repeat(64) },
    components: [{ outputs: [asset] }],
  } } }
  const policy = { version: 1, rules: [{ kind: 'prefix', path: 'release/', action: 'include', reason: 'synthetic regression' }] }
  const inspect = files => inspectPublicSnapshot({ ...fixture(t, files), policy })
  assert.equal(inspect({ [path]: JSON.stringify(manifest, null, 2) }).blockedFiles, 0)
  for (const files of [
    { [path]: JSON.stringify({ ...manifest, token: 'sk-' + 'Z'.repeat(24) }, null, 2) },
    { [path]: JSON.stringify({ ...manifest, note: asset }, null, 2) },
    { 'release/other.json': JSON.stringify(manifest, null, 2) },
    { [path]: JSON.stringify({ ...manifest, schemaVersion: 2 }, null, 2) },
    { [path]: JSON.stringify(manifest, null, 2) + '\ninvalid' },
  ]) assert.ok(inspect(files).blockedFiles > 0)
})

test('manifest scaffolding, contract and source regression are selected exactly after document closure', t => {
  const asset = '.agents/skills/design-bundle-creator/assets/skill.template.yaml'
  const doc = 'docs/bundle-contract.md'
  const regression = 'packages/core/test/bundle-manifest-template.test.mjs'
  const neighbor = '.agents/skills/design-bundle-creator/assets/future.template.yaml'
  const actualPolicy = actualSelectionPolicy()
  const files = Object.fromEntries([asset, doc, regression].map(path =>
    [path, readFileSync(new URL('../' + path, import.meta.url))]))
  files[neighbor] = '# Unreviewed synthetic neighboring asset\n'
  const sourceTest = files[regression].toString('utf8')
  assert.ok(sourceTest.includes(asset))
  assert.ok(sourceTest.includes(doc))
  assert.equal(files[doc].toString('utf8').split(`](../${asset})`).length - 1, 2)
  const expected = { [asset]: 'include', [doc]: 'include', [regression]: 'include' }
  for (const [path, action] of Object.entries(expected)) {
    const exact = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(exact.length, 1, path)
    assert.equal(exact[0].kind, 'file', path)
    assert.equal(exact[0].action, action, path)
  }
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy: actualPolicy })
  for (const [path, action] of Object.entries(expected)) {
    const entry = result.entries.find(row => row.path === path)
    assert.equal(entry.action, action, path) // Real first-match logic must override packages/.
    assert.deepEqual(entry.findings, [], path)
  }
  assert.equal(result.entries.find(row => row.path === neighbor).action, 'review')
  assert.equal(result.classificationComplete, false)
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})
const policy = rules => ({ version: 1, rules })
const include = path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })

test('explicit root config projection removes only repository private-source metadata, never secrets or other private fields', t => {
  const privateHost = ['gitlab', 'alibaba-inc', 'com'].join('.')
  const root = { private: true, repository: { type: 'git', url: `https://${privateHost}/synthetic/source.git` }, description: 'Public fixture' }
  const inspect = (value, publicSourceConfig) => inspectPublicSnapshot({
    ...fixture(t, { 'package.json': JSON.stringify(value) }), policy: policy([include('package.json')]), publicSourceConfig,
  })
  assert.equal(inspect(root, false).automatedChecksPassed, false)
  const projected = inspect(root, true)
  assert.equal(projected.automatedChecksPassed, true)
  assert.equal(projected.publicSourceConfigRequired, true)
  assert.equal(projected.releaseApproved, false)
  for (const value of [
    { ...root, description: `https://${privateHost}/synthetic/other.git` },
    { ...root, repository: { ...root.repository, extra: 'private metadata' } },
    { ...root, repository: { ...root.repository, url: root.repository.url + '/sk-' + 'x'.repeat(24) } },
    { ...root, repository: { ...root.repository, url: root.repository.url + ['', 'home', 'jeff', 'synthetic'].join('/') } },
    { ...root, repository: { ...root.repository, url: root.repository.url + '/' + ['llm-gateway', 'pre-opt', 'aliyun', 'com'].join('.') } },
  ]) assert.equal(inspect(value, true).automatedChecksPassed, false)
  assert.equal(inspect({ ...root, private: false }, true).automatedChecksPassed, false)
  const duplicates = fixture(t, { 'package.json': `{"private":true,"description":"${privateHost}/private","description":"public","repository":"${privateHost}/source"}` })
  assert.equal(inspectPublicSnapshot({ ...duplicates, policy: policy([include('package.json')]), publicSourceConfig: true }).automatedChecksPassed, false)
  assert.throws(() => inspect(root, 'true'), /must be boolean/)
})

test('selected font authority, licenses and binaries are exact; future materials stay under review', t => {
  const base = 'scripts/whiteboard-fonts/'
  const authorityBytes = readFileSync(new URL('../' + base + 'manifest.json', import.meta.url))
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  assert.equal(digest(authorityBytes), 'c164438115a40cdead905085e95298f28a4ffa2a3947512b9a98509f33c26972')
  const authority = JSON.parse(authorityBytes)
  assert.deepEqual(authority.fonts.map(font => font.role), ['regular', 'code'])
  const paths = [base + 'manifest.json', ...authority.fonts.flatMap(font => [base + font.licenseFile, base + font.file])]
  for (const font of authority.fonts) {
    const license = readFileSync(new URL('../' + base + font.licenseFile, import.meta.url))
    assert.equal(license.length, font.licenseBytes)
    assert.equal(digest(license), font.licenseSha256)
    const binary = readFileSync(new URL('../' + base + font.file, import.meta.url))
    assert.equal(binary.length, font.bytes)
    assert.equal(digest(binary), font.sha256)
  }
  const pending = [base + 'fonts/future-font.woff2', base + 'fonts/historical-font.woff2', base + 'licenses/future-OFL.txt', base + 'manifest-future.json']
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...fixture(t, Object.fromEntries([...paths, ...pending].map(path => [path, 'Synthetic selection fixture\n']))), policy: actualPolicy })
  for (const path of paths) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1, path)
    assert.equal(rules[0].kind, 'file')
    assert.equal(rules[0].action, 'include')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  }
  for (const path of pending) assert.equal(result.entries.find(entry => entry.path === path).action, 'review')
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('host credential template and its development regression are excluded exactly from the public plugin', t => {
  const excluded = ['.env.example', 'scripts/public-env-template.test.mjs']
  const neighbors = ['.env.example.public', 'scripts/public-env-template-public.test.mjs',
    'examples/future-public-config.json']
  const f = fixture(t, Object.fromEntries([...excluded, ...neighbors].map(path => [path, 'Synthetic fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of excluded) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(rules[0].action, 'exclude')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'exclude')
  }
  for (const path of neighbors) assert.equal(result.entries.find(entry => entry.path === path).action, 'review')
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('internal debugging directories are excluded without admitting similar names or future demos', t => {
  const excluded = ['.revcmp/P-003.lat3.bpmn', '.revcmp/nested/comparison.png',
    '.shots/ls.png', '__pycache__/bpmn_render.cpython-38.pyc', '.fm_dump.txt']
  const neighbors = ['.revcmp-public/example.bpmn', '.shots-public/demo.png',
    '__pycache__-source/helper.py', '.fm_dump.txt.public', 'docs/images/future-demo.png']
  const f = fixture(t, Object.fromEntries([...excluded, ...neighbors].map(path => [path, 'Synthetic fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of excluded) assert.equal(result.entries.find(entry => entry.path === path).action, 'exclude')
  for (const path of neighbors) assert.equal(result.entries.find(entry => entry.path === path).action, 'review')
  for (const path of ['.revcmp/', '.shots/', '__pycache__/', '.fm_dump.txt']) {
    const matches = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(matches.length, 1)
    assert.equal(matches[0].kind, path.endsWith('/') ? 'prefix' : 'file')
    assert.equal(matches[0].action, 'exclude')
  }
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('reviewed original screenshots are included exactly; private and future images stay guarded', t => {
  // Classification regression only: synthetic bytes do not test pixel privacy detection.
  const excluded = ['docs/images/design-panel.png']
  const selected = ['docs/dsl-spec.md', 'docs/images/design-panel-page-design.png',
    'docs/images/design-panel-prd.png', 'docs/images/design-panel-process.png']
  const neighbors = ['docs/images/future-demo.png']
  const f = fixture(t, Object.fromEntries([...excluded, ...selected, ...neighbors].map(path => [path, 'Synthetic fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of excluded) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'exclude')
  }
  for (const path of neighbors) assert.equal(result.entries.find(entry => entry.path === path).action, 'review')
  for (const path of selected) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1, path)
    assert.equal(rules[0].kind, 'file', path)
    assert.equal(rules[0].action, 'include', path)
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include', path)
  }
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('original screenshot reviews retain exact source bytes and reject changed blobs', t => {
  const expected = [
    ['docs/images/design-panel-process.png', 'db566a4397fed4b1118e1b8d86c9e7de703d5fbe', 1170164],
    ['docs/images/design-panel-prd.png', '83e8c6fe22ea43dba1437c1dd479c892d11b4e35', 1220862],
    ['docs/images/design-panel-page-design.png', '72ca17b7af3683bbd703ee68fb8adc971af08f97', 240164],
  ]
  const actual = JSON.parse(readFileSync(new URL('../release/public-source-policy.json', import.meta.url), 'utf8'))
  const paths = expected.map(([path]) => path)
  const reviewedFiles = actual.reviewedFiles.filter(row => paths.includes(row.path))
  assert.deepEqual(reviewedFiles.map(({ path, oid, bytes }) => [path, oid, bytes]), expected)
  const files = Object.fromEntries(paths.map(path => [path, readFileSync(new URL('../' + path, import.meta.url))]))
  const f = fixture(t, files)
  const policy = { version: actual.version, rules: actual.rules.filter(row => paths.includes(row.path)), reviewedFiles }
  assert.equal(inspectPublicSnapshot({ ...f, policy }).automatedChecksPassed, true)
  for (const [path] of expected) {
    writeFileSync(join(f.source, path), Buffer.from([0, 1]))
    f.git(['add', path])
    f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'changed screenshot'])
    assert.throws(() => inspectPublicSnapshot({ ...f, revision: f.git(['rev-parse', 'HEAD']).trim(), policy }), /review/i)
    f.git(['reset', '--hard', f.revision]) // Only the isolated synthetic fixture.
  }
})

test('reviewed generic smoke batches exclude classified internal gates but leave future scripts under review', t => {
  // Selection regression only; these synthetic bytes do not execute the smokes.
  const reviewed = ['scripts/smoke-accepted-assertions.mjs', 'scripts/smoke-advisory-currency.mjs',
    'scripts/smoke-advisory-knowledge.mjs', 'scripts/smoke-assertion-promotion.mjs',
    'scripts/smoke-clarity-long-evidence.mjs', 'scripts/smoke-design-advisory-journal.mjs',
    'scripts/smoke-design-graph-projection.mjs', 'scripts/smoke-design-artifact-publication.mjs',
    'scripts/smoke-design-continuation.mjs', 'scripts/smoke-design-execution-runtime.mjs',
    'scripts/smoke-design-journal.mjs', 'scripts/smoke-design-project.mjs',
    'scripts/smoke-design-project-registry.mjs', 'scripts/smoke-design-validation-phases.mjs']
  const neighbors = ['scripts/smoke-clarity-core.mjs', 'scripts/smoke-binary-artifact-remote.mjs',
    'scripts/smoke-binary-design-files.mjs', 'scripts/smoke-design-journal-registry.mjs',
    'scripts/smoke-design-files.mjs', 'scripts/smoke-design-knowledge-contract.mjs',
    'scripts/smoke-future-design-journal.mjs']
  const f = fixture(t, Object.fromEntries([...reviewed, ...neighbors].map(path => [path, 'Synthetic source fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of reviewed) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  }
  assertNeighborActions(result, actualPolicy, neighbors, neighbors.filter(path => path !== 'scripts/smoke-future-design-journal.mjs'))
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('reviewed source regressions are included exactly without admitting obsolete or future gates', t => {
  const reviewed = [
    'scripts/smoke-core-bundle-independence.mjs',
    'scripts/smoke-no-legacy-clarity.mjs',
    'scripts/smoke-schema.mjs',
    'scripts/smoke-validate.mjs',
    'scripts/smoke-validation-phases.mjs',
    'scripts/smoke-referenced-files.mjs',
  ]
  const neighbors = ['scripts/smoke-client-boundary.mjs', 'scripts/smoke-client-bundle.mjs',
    'scripts/smoke-future-schema.mjs', 'scripts/mock-design-server.mjs']
  const f = fixture(t, Object.fromEntries([...reviewed, ...neighbors].map(path => [path, 'Synthetic source fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of reviewed) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  }
  assertNeighborActions(result, actualPolicy, neighbors, ['scripts/smoke-client-boundary.mjs', 'scripts/smoke-client-bundle.mjs', 'scripts/mock-design-server.mjs'])
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('generic filesystem and DSL regressions do not admit host-coupled or stale native gates', t => {
  const reviewed = ['scripts/smoke-confined-fs.mjs', 'scripts/smoke-design-execution-derivation.mjs',
    'scripts/smoke-nav-guard.mjs', 'scripts/smoke-dsl-expressiveness.mjs',
    'scripts/smoke-dsl-declarative-basis.mjs', 'scripts/smoke-dsl-panel-data.mjs']
  const neighbors = ['scripts/smoke-atomic-writes.mjs', 'scripts/smoke-page-prd-ids.mjs',
    'scripts/smoke-feature-metadata.mjs', 'scripts/smoke-future-dsl.mjs']
  const f = fixture(t, Object.fromEntries([...reviewed, ...neighbors].map(path => [path, 'Synthetic source fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of reviewed) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  }
  assertNeighborActions(result, actualPolicy, neighbors, ['scripts/smoke-atomic-writes.mjs', 'scripts/smoke-page-prd-ids.mjs', 'scripts/smoke-feature-metadata.mjs'])
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('generic conditional slots and grounding checks exclude classified stale scaffolds but leave future gates under review', t => {
  const reviewed = ['scripts/smoke-conditional-bundle-slots.mjs', 'scripts/smoke-kit-grounding-mapping.mjs']
  const neighbors = ['scripts/smoke-kit-load.mjs', 'scripts/smoke-scaffold.mjs',
    'scripts/smoke-future-grounding.mjs', 'scripts/smoke-future-bundle-slots.mjs']
  const f = fixture(t, Object.fromEntries([...reviewed, ...neighbors].map(path => [path, 'Synthetic source fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of reviewed) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  }
  assertNeighborActions(result, actualPolicy, neighbors, ['scripts/smoke-kit-load.mjs', 'scripts/smoke-scaffold.mjs'])
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('real export policy excludes host source and metadata but retains plugin source', t => {
  const f = fixture(t, {
    '.gitmodules': '[submodule "deepseek-harness"]\npath = deepseek-harness\nurl = https://example.invalid/host.git\n',
    'deepseek-harness/package.json': '{}',
    'deepseek-harness/apps/cli/index.js': 'export {}',
    'packages/dsh/src/index.ts': 'export {}',
    'deepseek-harness-not-a-host.txt': 'requires its own decision',
  })
  const actualPolicy = actualSelectionPolicy()
  const r = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  const action = path => r.entries.find(e => e.path === path)?.action
  assert.equal(action('.gitmodules'), 'exclude')
  assert.equal(action('deepseek-harness/package.json'), 'exclude')
  assert.equal(action('deepseek-harness/apps/cli/index.js'), 'exclude')
  assert.equal(action('packages/dsh/src/index.ts'), 'include')
  assert.equal(action('deepseek-harness-not-a-host.txt'), 'review')
})

test('real export policy excludes a host gitlink without resolving its checkout', t => {
  const f = fixture(t, { 'LICENSE': 'fixture license' })
  f.git(['update-index', '--add', '--cacheinfo', `160000,${f.revision},deepseek-harness`])
  f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'host gitlink'])
  f.revision = f.git(['rev-parse', 'HEAD']).trim()
  const r = inspectPublicSnapshot({ ...f, policy: actualSelectionPolicy() })
  const host = r.entries.find(e => e.path === 'deepseek-harness')
  assert.equal(host.mode, '160000')
  assert.equal(host.action, 'exclude')
  assert.deepEqual(host.findings, [])
  assert.equal(r.releaseApproved, false)
})

test('public policy excludes internal dogfood setup while retaining host integration code', t => {
  const excluded = ['start.sh', 'scripts/bootstrap-dogfood.mjs', 'scripts/setup-dogfood.mjs',
    'scripts/start-dogfood.mjs', 'scripts/smoke-dogfood-setup.mjs']
  const f = fixture(t, Object.fromEntries([...excluded, 'packages/core/src/dsh-design-execution-plugin.ts',
    'scripts/setup-other-host.mjs'].map(path => [path, 'fixture\n'])))
  const r = inspectPublicSnapshot({ ...f, policy: actualSelectionPolicy() })
  for (const path of excluded) assert.equal(r.entries.find(e => e.path === path).action, 'exclude')
  assert.equal(r.entries.find(e => e.path === 'packages/core/src/dsh-design-execution-plugin.ts').action, 'include')
  assert.equal(r.entries.find(e => e.path === 'scripts/setup-other-host.mjs').action, 'review')
  assert.equal(r.automatedChecksPassed, false)
})

test('public authoring guidance is selected by exact path without granting future files', t => {
  const actualPolicy = actualSelectionPolicy()
  const selected = actualPolicy.rules.filter(rule => rule.path.startsWith('.agents/skills/design-'))
  assert.deepEqual(selected.map(rule => rule.path).sort(), [
    '.agents/skills/design-bundle-creator/SKILL.md',
    '.agents/skills/design-bundle-creator/agents/openai.yaml',
    '.agents/skills/design-bundle-creator/assets/skill.template.yaml',
    '.agents/skills/design-bundle-creator/references/bundle-checklist.md',
    '.agents/skills/design-bundle-creator/references/canvas-authoring.md',
    '.agents/skills/design-bundle-creator/references/cooperation-authoring.md',
    '.agents/skills/design-bundle-creator/references/panel-authoring.md',
    '.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs',
    '.agents/skills/design-bundle-creator/scripts/list-panel-components.mjs',
    '.agents/skills/design-kit-creator/SKILL.md',
    '.agents/skills/design-kit-creator/agents/openai.yaml',
    '.agents/skills/design-kit-creator/references/kit-checklist.md',
    '.agents/skills/design-kit-creator/references/mindset-authoring.md',
    '.agents/skills/design-skill-creator/SKILL.md',
    '.agents/skills/design-skill-creator/agents/openai.yaml',
    '.agents/skills/design-skill-creator/assets/method-template.md',
    '.agents/skills/design-skill-creator/references/standards.md',
    '.agents/skills/design-skill-creator/scripts/render-state-contract.mjs',
  ].sort())
  assert.ok(selected.every(rule => rule.kind === 'file' && rule.action === 'include'))
  const unknown = '.agents/skills/design-kit-creator/unreviewed.md'
  const f = fixture(t, Object.fromEntries([...selected.map(rule => rule.path), unknown].map(path => [path, 'portable fixture\n'])))
  const r = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const rule of selected) assert.equal(r.entries.find(entry => entry.path === rule.path).action, 'include')
  assert.equal(r.entries.find(entry => entry.path === unknown).action, 'review')
  assert.equal(r.automatedChecksPassed, false)
})

test('internal example overlays are excluded exactly without discarding future public demos', t => {
  const paths = ['examples/dogfood-model-route.patch.yml', 'examples/panel-lab.patch.yml']
  const actualPolicy = actualSelectionPolicy()
  for (const path of paths) {
    const matches = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(matches.length, 1)
    assert.equal(matches[0].kind, 'file')
    assert.equal(matches[0].action, 'exclude')
    assert.ok(matches[0].reason.trim())
  }
  const future = 'examples/future-portable-demo/README.md'
  const f = fixture(t, Object.fromEntries([...paths, future].map(path => [path, 'synthetic fixture\n'])))
  const r = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of paths) assert.equal(r.entries.find(entry => entry.path === path).action, 'exclude')
  assert.equal(r.entries.find(entry => entry.path === future).action, 'review')
  assert.equal(r.automatedChecksPassed, false)
})

test('historical driver fixture exclusions are exact and leave new fixtures under review', t => {
  const actualPolicy = actualSelectionPolicy()
  const roots = ['scripts/fixtures/agentic-loader-kit/', 'scripts/fixtures/agentic-loader-kit-bare/', 'scripts/fixtures/agentic-loader-kit-unknown/']
  const selected = actualPolicy.rules.filter(rule => roots.some(root => rule.path.startsWith(root)))
  // Independent inventory from baseline 32a847b012fd04e3c37ea90bbe45555a827a01ed.
  // Do not derive the expected paths from the policy under test: a same-count
  // typo would otherwise pass. Keep this usable without development Git history.
  const expected = [
    'scripts/fixtures/agentic-loader-kit-bare/mindset.md',
    'scripts/fixtures/agentic-loader-kit-bare/skills/digest_agent/SKILL.md',
    'scripts/fixtures/agentic-loader-kit-bare/skills/digest_agent/schema.yaml',
    'scripts/fixtures/agentic-loader-kit-bare/skills/digest_agent/skill.yaml',
    'scripts/fixtures/agentic-loader-kit-bare/skills/digest_agent/validation.yaml',
    'scripts/fixtures/agentic-loader-kit-unknown/mindset.md',
    'scripts/fixtures/agentic-loader-kit-unknown/skills/notes_agent/SKILL.md',
    'scripts/fixtures/agentic-loader-kit-unknown/skills/notes_agent/panel.yaml',
    'scripts/fixtures/agentic-loader-kit-unknown/skills/notes_agent/renderer.md',
    'scripts/fixtures/agentic-loader-kit-unknown/skills/notes_agent/schema.yaml',
    'scripts/fixtures/agentic-loader-kit-unknown/skills/notes_agent/skill.yaml',
    'scripts/fixtures/agentic-loader-kit-unknown/skills/notes_agent/validation.yaml',
    'scripts/fixtures/agentic-loader-kit/mindset.md',
    'scripts/fixtures/agentic-loader-kit/skills/digest_agent/SKILL.md',
    'scripts/fixtures/agentic-loader-kit/skills/digest_agent/schema.yaml',
    'scripts/fixtures/agentic-loader-kit/skills/digest_agent/skill.yaml',
    'scripts/fixtures/agentic-loader-kit/skills/digest_agent/validation.yaml',
    'scripts/fixtures/agentic-loader-kit/skills/notes_agent/SKILL.md',
    'scripts/fixtures/agentic-loader-kit/skills/notes_agent/panel.yaml',
    'scripts/fixtures/agentic-loader-kit/skills/notes_agent/renderer.md',
    'scripts/fixtures/agentic-loader-kit/skills/notes_agent/schema.yaml',
    'scripts/fixtures/agentic-loader-kit/skills/notes_agent/skill.yaml',
    'scripts/fixtures/agentic-loader-kit/skills/notes_agent/validation.yaml',
  ]
  assert.deepEqual(selected.map(rule => rule.path).sort(), expected)
  assert.ok(selected.every(rule => rule.kind === 'file' && rule.action === 'exclude'))
  const neighbors = ['scripts/fixtures/agentic-loader-kit/new-runtime-test.mjs', 'scripts/fixtures/agentic-loader-kit-future/skills/new/SKILL.md']
  const f = fixture(t, Object.fromEntries([...expected, ...neighbors].map(path => [path, 'Synthetic fixture\n'])))
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const rule of selected) assert.equal(result.entries.find(entry => entry.path === rule.path).action, 'exclude')
  for (const path of neighbors) assert.equal(result.entries.find(entry => entry.path === path).action, 'review')
  assert.equal(result.releaseApproved, false)
})

test('historical delivery plan is excluded exactly; selected guidance does not admit future or historical neighbors', t => {
  const path = 'docs/delivery-plan.md'
  const selected = ['docs/standalone-roadmap.md', 'docs/system-design-baseline.md']
  const neighbors = ['docs/future-delivery-plan.md', 'docs/historical-delivery-plan.md']
  const f = fixture(t, Object.fromEntries([path, ...selected, ...neighbors].map(name => [name, 'Synthetic documentation fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  const rules = actualPolicy.rules.filter(rule => rule.path === path)
  assert.equal(rules.length, 1)
  assert.equal(rules[0].kind, 'file')
  assert.equal(rules[0].action, 'exclude')
  assert.equal(result.entries.find(entry => entry.path === path).action, 'exclude')
  for (const selectedPath of selected) {
    const selectedRules = actualPolicy.rules.filter(rule => rule.path === selectedPath)
    assert.equal(selectedRules.length, 1, selectedPath)
    assert.equal(selectedRules[0].kind, 'file', selectedPath)
    assert.equal(selectedRules[0].action, 'include', selectedPath)
    assert.equal(result.entries.find(entry => entry.path === selectedPath).action, 'include', selectedPath)
  }
  for (const neighbor of neighbors) assert.equal(result.entries.find(entry => entry.path === neighbor).action, 'review')
  assert.equal(result.releaseApproved, false)
})

test('reviewed release helpers are exact inclusions without admitting unreviewed neighboring scripts', t => {
  const paths = [
    'THIRD_PARTY_NOTICES.md',
    'scripts/release-consumer-config.mjs', 'scripts/release-consumer-config.test.mjs',
    'scripts/release-physical-distribution-gate.mjs',
    'scripts/release-evidence.mjs', 'scripts/release-evidence.test.mjs',
    'scripts/release-own-license.mjs', 'scripts/release-own-license.test.mjs',
    'scripts/kit-test-file-policy.mjs', 'scripts/kit-test-file-policy.test.mjs',
    'scripts/official-dsh-json-input.mjs', 'scripts/official-dsh-json-input.test.mjs',
  ]
  const neighbors = ['scripts/release-future-config.mjs', 'scripts/release-evidence-future.test.mjs',
    'scripts/kit-test-file-policy-future.mjs', 'scripts/official-dsh-json-input-future.mjs',
    'scripts/release-physical-distribution-future-gate.mjs']
  const f = fixture(t, Object.fromEntries([...paths, ...neighbors].map(path => [path, 'Synthetic source fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of paths) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(rules[0].action, 'include')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  }
  for (const path of neighbors) assert.equal(result.entries.find(entry => entry.path === path).action, 'review')
  // Including the preparation inventory does not approve its pending license obligations.
  assert.equal(result.releaseApproved, false)
})

test('classified historical execution-note exclusions leave future architecture documentation under review', t => {
  const paths = [
    'docs/agent-note-2026-08-28-producer-owned-design-project.md',
    'docs/agent-note-2026-08-29-native-delegation-live-artifacts.md',
    'docs/agent-note-2026-08-29-progressive-producer-publication.md',
    'docs/agent-note-2026-08-29-producer-session-identity.md',
    'docs/agent-note-2026-08-30-publication-coordinator.md',
    'docs/agent-note-2026-08-30-current-advisory-set.md',
    'docs/agent-note-2026-08-30-page-map-functional-groups.md',
    'docs/agent-note-2026-08-31-design-state-authority.md',
    'docs/agent-note-2026-08-28-studio-kit-working-copies.md',
    'docs/agent-note-2026-08-29-research-evidence-provenance.md',
  ]
  const neighbors = ['docs/design-project-knowledge-lifecycle.md',
    'docs/agent-note-2026-08-28-localized-skill-titles.md',
    'docs/agent-note-2026-08-28-owned-artifact-sets.md',
    'docs/agent-note-2026-08-30-page-visual-baseline.md',
    'docs/future-publication-architecture.md']
  const f = fixture(t, Object.fromEntries([...paths, ...neighbors].map(path => [path, 'Synthetic documentation fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of paths) assert.equal(result.entries.find(entry => entry.path === path).action, 'exclude')
  assertNeighborActions(result, actualPolicy, neighbors, ['docs/design-project-knowledge-lifecycle.md',
    'docs/agent-note-2026-08-28-localized-skill-titles.md', 'docs/agent-note-2026-08-28-owned-artifact-sets.md', 'docs/agent-note-2026-08-30-page-visual-baseline.md'])
  assert.equal(result.releaseApproved, false)
})

test('public product principles and architecture baseline are selected without approving sibling documents', t => {
  const reviewed = 'docs/product-vision.md'
  const baseline = 'docs/system-design-baseline.md'
  const concepts = 'docs/wiki/concepts.md'
  const archived = 'docs/internal/documentation-first-pass/docs/wiki/concepts.md'
  const neighbors = ['docs/wiki/concepts-future.md', 'docs/system-design-baseline-future.md', 'docs/product-vision-future.md']
  const f = fixture(t, Object.fromEntries([reviewed, baseline, concepts, archived, ...neighbors].map(path => [path, 'Synthetic public documentation fixture\n'])))
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  assert.equal(result.entries.find(entry => entry.path === reviewed).action, 'include')
  assert.equal(result.entries.find(entry => entry.path === baseline).action, 'include')
  assert.equal(result.entries.find(entry => entry.path === concepts).action, 'include')
  assert.equal(result.entries.find(entry => entry.path === archived).action, 'exclude')
  assertNeighborActions(result, actualPolicy, neighbors, [])
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('reviewed authoring resources and physical entry regression are exact inclusions, not sibling approvals', t => {
  const reviewed = ['scripts/release-physical-entry.test.mjs',
    '.agents/skills/design-bundle-creator/references/panel-authoring.md',
    '.agents/skills/design-bundle-creator/scripts/list-panel-components.mjs',
    '.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs']
  const pending = ['scripts/release-physical-future.test.mjs',
    '.agents/skills/design-bundle-creator/references/future-authoring.md',
    '.agents/skills/design-bundle-creator/scripts/future-components.mjs',
    '.agents/skills/design-bundle-creator/scripts/inspect-panel-component-future.mjs',
    '.agents/skills/future-creator/SKILL.md']
  const actualPolicy = actualSelectionPolicy()
  // Policy selection alone must not stand in for actually delivered authoring inputs.
  for (const path of reviewed) {
    assert.ok(readFileSync(new URL('../' + path, import.meta.url), 'utf8').trim(),
      'Reviewed source must exist and be readable: ' + path)
  }
  const skill = readFileSync(new URL('../.agents/skills/design-bundle-creator/SKILL.md', import.meta.url), 'utf8')
  assert.ok(skill.includes('(references/panel-authoring.md)'), 'Authoring reference must be reachable from the skill')
  const authoring = readFileSync(new URL('../.agents/skills/design-bundle-creator/references/panel-authoring.md', import.meta.url), 'utf8')
  for (const name of ['list-panel-components.mjs', 'inspect-panel-component.mjs']) {
    assert.ok(authoring.includes('scripts/' + name), 'Authoring reference must route to ' + name)
    assert.ok(readFileSync(new URL('../.agents/skills/design-bundle-creator/scripts/' + name, import.meta.url), 'utf8').trim(),
      'Referenced read-only helper must exist: ' + name)
  }
  const files = Object.fromEntries([...reviewed, ...pending].map(path => [path, 'Synthetic selection fixture\n']))
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy: actualPolicy })
  for (const path of reviewed) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1, path)
    assert.equal(rules[0].kind, 'file')
    assert.equal(rules[0].action, 'include')
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  }
  for (const path of pending) assert.equal(result.entries.find(entry => entry.path === path).action, 'review')
  assert.equal(result.classificationComplete, false)
  assert.equal(result.releaseApproved, false)
})

test('task handoff guide and selected linked contracts do not approve future sibling guides', t => {
  const path = 'docs/design-development-handoff.md'
  const linked = ['docs/system-design-baseline.md', 'docs/bundle-contract.md',
    'docs/dsl-spec.md', 'docs/standalone-roadmap.md']
  const pending = ['docs/design-development-handoff-future.md', 'docs/bundle-contract-future.md']
  const actualPolicy = actualSelectionPolicy()
  const rules = actualPolicy.rules.filter(rule => rule.path === path)
  assert.equal(rules.length, 1)
  assert.equal(rules[0].kind, 'file')
  assert.equal(rules[0].action, 'include')
  const document = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  assert.ok(document.includes('已完成的代表性新会话开发与反馈闭环及其范围见下文'))
  assert.ok(document.includes('这些结果不代表所有宿主、Kit 或完整视觉验收'))
  assert.ok(document.includes('验收必须使用同一已安装发行候选'))
  assert.ok(document.includes('不能套用 Web App 的文件名或字段'))
  assert.ok(document.includes('本指南不授予发布、部署'))
  const files = { [path]: document }
  for (const name of linked) {
    const exact = actualPolicy.rules.filter(rule => rule.kind === 'file' && rule.path === name)
    assert.equal(exact.length, 1, name)
    assert.equal(exact[0].action, 'include', name)
    files[name] = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
  }
  for (const name of pending) files[name] = 'Synthetic unreviewed document\n'
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy: actualPolicy })
  assert.equal(result.entries.find(entry => entry.path === path).action, 'include')
  assert.deepEqual(result.entries.find(entry => entry.path === path).findings, [])
  for (const name of linked) assert.equal(result.entries.find(entry => entry.path === name).action, 'include')
  for (const name of pending) assert.equal(result.entries.find(entry => entry.path === name).action, 'review')
  assert.equal(result.classificationComplete, false)
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})

test('public policy retains graph build helpers without including arbitrary sibling scripts', t => {
  const helpers = ['scripts/graph-browser-dependencies.ts', 'scripts/graph-layout-worker.ts']
  const actualPolicy = actualSelectionPolicy()
  for (const consumer of ['packages/panel/tsdown.config.ts', 'packages/companion/tsdown.config.ts']) {
    const code = readFileSync(new URL(`../${consumer}`, import.meta.url), 'utf8')
    for (const helper of helpers) assert.ok(code.includes(`../../${helper}`), `${consumer} requires ${helper}`)
  }
  const unknown = 'scripts/graph-unreviewed-helper.ts'
  const files = Object.fromEntries(helpers.map(path => [path, readFileSync(new URL(`../${path}`, import.meta.url))]))
  files[unknown] = 'export const unreviewed = true\n'
  const f = fixture(t, files)
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of helpers) {
    const entry = result.entries.find(entry => entry.path === path)
    assert.equal(entry.action, 'include')
    assert.deepEqual(entry.findings, [])
    assert.equal(actualPolicy.rules.find(rule => rule.path === path).kind, 'file')
  }
  assert.equal(result.entries.find(entry => entry.path === unknown).action, 'review')
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})

test('reviewed user behavior documents are exact-path inclusions, not a blanket docs approval', t => {
  const paths = ['docs/advisory-reading.md', 'docs/panel-unread.md',
    'docs/ust-score-explanations.md', 'docs/design-command-agent-entry.md']
  const pending = ['docs/design-project-knowledge-lifecycle.md', 'docs/future-user-guide.md']
  const actualPolicy = actualSelectionPolicy()
  for (const path of paths) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].kind, 'file')
    assert.equal(rules[0].action, 'include')
  }
  const files = Object.fromEntries(paths.map(path => [path, readFileSync(new URL(`../${path}`, import.meta.url))]))
  for (const path of pending) files[path] = 'Synthetic unreviewed document\n'
  const f = fixture(t, files)
  const result = inspectPublicSnapshot({ ...f, policy: actualPolicy })
  for (const path of paths) {
    const entry = result.entries.find(entry => entry.path === path)
    assert.equal(entry.action, 'include')
    assert.deepEqual(entry.findings, [])
  }
  assertNeighborActions(result, actualPolicy, pending, ['docs/design-project-knowledge-lifecycle.md'])
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})

test('component catalog extension contract is reviewed without approving neighboring A2UI research', t => {
  const path = 'docs/a2ui-component-catalog-contract.md'
  const pending = ['docs/a2ui-auto-panel-pilot-2026-09-23.md', 'docs/future-component-contract.md']
  const actualPolicy = actualSelectionPolicy()
  const rules = actualPolicy.rules.filter(rule => rule.path === path)
  assert.equal(rules.length, 1)
  assert.equal(rules[0].kind, 'file')
  assert.equal(rules[0].action, 'include')
  const document = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  assert.ok(document.includes('AUTO_PANEL_COMPONENT_KINDS'))
  assert.ok(document.includes('validateAutoPanelEdit'))
  assert.ok(document.includes('structured_data'))
  const files = { [path]: document }
  for (const name of pending) files[name] = 'Synthetic unreviewed component document\n'
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy: actualPolicy })
  const entry = result.entries.find(entry => entry.path === path)
  assert.equal(entry.action, 'include')
  assert.deepEqual(entry.findings, [])
  assertNeighborActions(result, actualPolicy, pending, ['docs/a2ui-auto-panel-pilot-2026-09-23.md'])
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})

test('reads committed bytes only and never includes untracked or dirty bytes', t => {
  const f = fixture(t, { 'public.txt': 'clean\n' })
  writeFileSync(join(f.source, 'public.txt'), 'sk-' + 'x'.repeat(24))
  writeFileSync(join(f.source, 'untracked.txt'), 'private')
  const r = inspectPublicSnapshot({ ...f, policy: policy([include('public.txt')]) })
  assert.equal(r.automatedChecksPassed, true)
  assert.equal(r.releaseApproved, false)
  assert.deepEqual(r.entries.map(e => e.path), ['public.txt'])
})

test('unknown files block and excluded files are explicitly accounted for', t => {
  const f = fixture(t, { 'public.txt': 'clean', 'internal.txt': 'private', 'unknown.txt': 'check' })
  const r = inspectPublicSnapshot({ ...f, policy: policy([include('public.txt'), { ...include('internal.txt'), action: 'exclude' }]) })
  assert.deepEqual(r.counts, { include: 1, exclude: 1, review: 1 })
  assert.equal(r.blockedFiles, 1)
})

test('findings contain only type and line, never matched credential values', t => {
  const secret = 'sk-' + 'ExampleFixtureOnly'.repeat(2)
  const f = fixture(t, { 'public.txt': 'header\n' + secret })
  const r = inspectPublicSnapshot({ ...f, policy: policy([include('public.txt')]) })
  assert.equal(r.automatedChecksPassed, false)
  assert.deepEqual(r.entries[0].findings, [{ kind: 'credential_like', line: 2 }])
  assert.equal(JSON.stringify(r).includes(secret), false)
})

test('symlinks and binary/large files require review without following targets', t => {
  const f = fixture(t, { 'base.txt': 'clean', 'image.bin': Buffer.from([0, 1, 2]), 'large.txt': 'a'.repeat(1024 * 1024 + 1) })
  symlinkSync('/nonexistent/private-file', join(f.source, 'alias'))
  f.git(['add', 'alias'])
  f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'symlink'])
  f.revision = f.git(['rev-parse', 'HEAD']).trim()
  const r = inspectPublicSnapshot({ ...f, policy: policy(['base.txt', 'image.bin', 'large.txt', 'alias'].map(include)) })
  assert.equal(r.blockedFiles, 3)
  assert.equal(JSON.stringify(r).includes('/nonexistent/private-file'), false)
})

test('rejects mutable refs and invalid policy paths before inspection', t => {
  const f = fixture(t, { 'public.txt': 'clean' })
  assert.throws(() => inspectPublicSnapshot({ ...f, revision: 'HEAD', policy: policy([]) }), /immutable/u)
  assert.throws(() => inspectPublicSnapshot({ ...f, policy: policy([include('../escape')]) }), /rule/u)
  assert.throws(() => inspectPublicSnapshot({ ...f, policy: policy([{ kind: 'prefix', path: '', action: 'include', reason: 'all' }]) }), /rule/u)
})

test('local Git replacement refs cannot substitute the requested committed bytes', t => {
  const f = fixture(t, { 'public.txt': 'clean' })
  const original = f.revision
  writeFileSync(join(f.source, 'public.txt'), 'sk-' + 'ReplacementFixtureOnly'.repeat(2))
  f.git(['add', '.'])
  f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'replacement'])
  const replacement = f.git(['rev-parse', 'HEAD']).trim()
  f.git(['replace', original, replacement])
  const r = inspectPublicSnapshot({ ...f, revision: original, policy: policy([include('public.txt')]) })
  assert.equal(r.revision, original)
  assert.equal(r.automatedChecksPassed, true)
  assert.equal(r.entries[0].bytes, 5)
})

test('blob replacement cannot hide a committed credential-like fixture', t => {
  const f = fixture(t, { 'public.txt': 'sk-' + 'OriginalFixtureOnly'.repeat(2) })
  const original = f.revision
  const originalBlob = f.git(['rev-parse', `${original}:public.txt`]).trim()
  writeFileSync(join(f.source, 'public.txt'), 'clean')
  f.git(['add', '.'])
  const cleanBlob = f.git(['rev-parse', ':public.txt']).trim()
  f.git(['replace', originalBlob, cleanBlob])
  const r = inspectPublicSnapshot({ ...f, policy: policy([include('public.txt')]) })
  assert.equal(r.automatedChecksPassed, false)
  assert.equal(r.publicationStatus, 'local-unreviewed')
  assert.equal(r.entries[0].findings[0].kind, 'credential_like')
})

test('manual binary/large review is bound to exact included blob and cannot waive security findings', t => {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 1)
  const f = fixture(t, { 'runtime.wasm': bytes, 'secret.txt': 'sk-' + 'FixtureCredentialOnly'.repeat(2) })
  const oid = f.git(['rev-parse', `${f.revision}:runtime.wasm`]).trim()
  const reviewed = { path: 'runtime.wasm', oid, bytes: bytes.length, findings: ['large_file_manual_review'], reason: 'Synthetic binary reviewed for fixture only' }
  const p = { ...policy([include('runtime.wasm'), { ...include('secret.txt'), action: 'exclude' }]), reviewedFiles: [reviewed] }
  const r = inspectPublicSnapshot({ ...f, policy: p })
  assert.equal(r.automatedChecksPassed, true)
  assert.equal(r.releaseApproved, false)
  assert.deepEqual(r.entries.find(entry => entry.path === 'runtime.wasm').findings, [{ kind: 'large_file_manual_review' }])
  for (const mutation of [{ oid: '0'.repeat(40) }, { bytes: bytes.length - 1 }, { path: 'missing' },
    { findings: ['credential_like'] }, { findings: ['large_file_manual_review', 'large_file_manual_review'] }]) {
    assert.throws(() => inspectPublicSnapshot({ ...f, policy: { ...p, reviewedFiles: [{ ...reviewed, ...mutation }] } }), /review/i)
  }
  assert.throws(() => inspectPublicSnapshot({ ...f, policy: { ...p, reviewedFiles: [reviewed, reviewed] } }), /review/i)
  assert.throws(() => inspectPublicSnapshot({ ...f, policy: { ...p, rules: [{ ...include('runtime.wasm'), action: 'exclude' }] } }), /review/i)
  assert.equal(inspectPublicSnapshot({ ...f, policy: { ...p, rules: [include('runtime.wasm'), include('secret.txt')] } }).automatedChecksPassed, false)
  const original = f.revision
  writeFileSync(join(f.source, 'runtime.wasm'), Buffer.from([0, 1]))
  f.git(['add', '.']); f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'changed blob'])
  assert.throws(() => inspectPublicSnapshot({ ...f, revision: f.git(['rev-parse', 'HEAD']).trim(), policy: p }), /review/i)
  assert.equal(inspectPublicSnapshot({ ...f, revision: original, policy: p }).automatedChecksPassed, true)
})

test('an exact small binary review does not silently clear other findings', t => {
  const bytes = Buffer.from([0, 1, 2]), f = fixture(t, { 'image.bin': bytes })
  const base = policy([include('image.bin')])
  assert.equal(inspectPublicSnapshot({ ...f, policy: base }).automatedChecksPassed, false)
  const reviewedFiles = [{ path: 'image.bin', oid: f.git(['rev-parse', `${f.revision}:image.bin`]).trim(), bytes: bytes.length,
    findings: ['binary_manual_review'], reason: 'Synthetic binary fixture' }]
  assert.equal(inspectPublicSnapshot({ ...f, policy: { ...base, reviewedFiles } }).automatedChecksPassed, true)
  assert.equal(inspectPublicSnapshot({ ...f, policy: { ...base, reviewedFiles: [{ ...reviewedFiles[0], findings: ['large_file_manual_review'] }] } }).automatedChecksPassed, false)
})

test('review approval cannot lift the fixed single-file capacity', t => {
  const bytes = Buffer.alloc(32 * 1024 * 1024 + 1), f = fixture(t, { 'too-large.wasm': bytes })
  const base = policy([include('too-large.wasm')])
  const result = inspectPublicSnapshot({ ...f, policy: base })
  assert.equal(result.automatedChecksPassed, false)
  assert.ok(result.entries[0].findings.some(finding => finding.kind === 'export_file_capacity_exceeded'))
  assert.throws(() => inspectPublicSnapshot({ ...f, policy: { ...base, reviewedFiles: [{ path: 'too-large.wasm', oid: result.entries[0].oid,
    bytes: bytes.length, findings: ['large_file_manual_review'], reason: 'Cannot authorize beyond exporter bounds' }] } }), /review/i)
})


test('execution provenance sources keep explicit classification and ordinary security review', t => {
  const included = ['packages/core/src/dsh-execution-provenance.ts', 'packages/core/test/dsh-execution-provenance.test.mjs']
  // The previously reviewed Core trees remain unchanged; do not invent a new per-file gate there.
  const pending = ['scripts/future-execution-provenance-probe.mjs', 'docs/future-execution-provenance.md']
  const files = Object.fromEntries([...included, ...pending].map(path => [path, 'Synthetic public selection boundary\n']))
  files[included[0]] = `${['gitlab', 'alibaba-inc', 'com'].join('.')}/internal\n`
  const policy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy })
  for (const path of included) {
    assert.equal(policy.rules.filter(rule => rule.path === path && rule.kind === 'file' && rule.action === 'include').length, 1)
    assert.equal(result.entries.find(entry => entry.path === path).action, 'include', path)
  }
  for (const path of pending) assert.equal(result.entries.find(entry => entry.path === path).action, 'review', path)
  assert(result.entries.find(entry => entry.path === included[0]).findings.some(finding => finding.kind === 'private_source'))
  assert.equal(result.releaseApproved, false)
})

test('active bundled materials use exact public paths; historical and future siblings remain review', async t => {
  // Real selected text bytes and fixed authority; no build, package install or license acceptance.
  const expected = {
  "third-party/companion/pako-1.0.11/LICENSE": {
    "bytes": 1104,
    "sha256": "a04665b3b2de56c66730c1f720f528175739e4104f79073614aa611da1e85539"
  },
  "third-party/companion/pako-1.0.11/SOURCE.md": {
    "bytes": 1472,
    "sha256": "8a5a9a98fb3ab31e406f4c52d5e26a3373ae418f9de5eacdebe45a8c0b7ec581"
  },
  "third-party/companion/pako-1.0.11/zlib-README": {
    "bytes": 2180,
    "sha256": "d8b499598e43d755ea8918448128259ff01820c50d94d5a48c8883d0a594ddb1"
  },
  "third-party/companion/bpmn-js-18.24.0/LICENSE": {
    "bytes": 1390,
    "sha256": "5788cf8bd61481776cee1c943595525499a1355c045e9244f92e6c8092c06770"
  },
  "third-party/companion/bpmn-js-18.24.0/SOURCE.md": {
    "bytes": 695,
    "sha256": "efcb82985a4bc325ed4320c64910e5f0408a89f7a027493e66ba8192bc7e5c08"
  },
  "third-party/companion/elkjs-0.10.2/LICENSE.md": {
    "bytes": 14480,
    "sha256": "89591d4578fb1ebd91501312a3d25f021bd865a2e436641c1cf7b1bc7e3c1617"
  },
  "third-party/companion/elkjs-0.10.2/SOURCE.md": {
    "bytes": 3961,
    "sha256": "d58c5d5ff4cc9c18456e6379b9303e3e60f51dcd884e68be67a4b5eaa7989f64"
  },
  "third-party/companion/elkjs-0.10.2/NOTICE.md": {
    "bytes": 1769,
    "sha256": "cf5ce01bb3b3b7974cfa296cd14c2be4de7f88ab67d7b911b0a402e382fb2701"
  },
  "third-party/companion/elkjs-0.10.2/DEPENDENCIES": {
    "bytes": 71676,
    "sha256": "4e441b47d606b18cdd1937cbbe5d79f92ca72dfe5d56327f5e2c6ff35e42a558"
  },
  "third-party/companion/elkjs-0.10.2/graph-layout-worker.ts": {
    "bytes": 1948,
    "sha256": "ec766700ef21f6464fde45ac217975cb9468815113159d3bf77156ed511ca523"
  },
  "third-party/companion/elkjs-0.10.2/release-source-binding.json": {
    "bytes": 3766,
    "sha256": "581bc1cdf3beebcbb6373f1501bc267e6993ec0835b687aaf8adb0ea91a2b0ba"
  },
  "third-party/companion/elkjs-0.10.2/upstream-README.md": {
    "bytes": 15891,
    "sha256": "5f01b86cacdaf3e9928e24bcddf4e91ca344b859831ed856d6fcba3a2c4a24ac"
  },
  "third-party/companion/elkjs-0.10.2/upstream-build.gradle": {
    "bytes": 9756,
    "sha256": "36c74b36571d3fca2fb3b5df492314c1ed6ddd0eb982899a0b2791dfa9c435d4"
  },
  "third-party/companion/elkjs-0.10.2/upstream-ci.yml": {
    "bytes": 1551,
    "sha256": "a38c88225333591436c479fcede470df46a409cf13fa8fafdefa048ae0455d4e"
  },
  "third-party/companion/index.json": {
    "bytes": 2216,
    "sha256": "cd9738909fe24591e56a1ec00ac8f4402f28546b26ced393cc6866064aeca8f0"
  },
  "third-party/companion/provenance.json": {
    "bytes": 3681,
    "sha256": "4d81a325a1918da1ad317722e74879e9b5c3b60de63fe496d3c0cadd46818a1d"
  },
  "third-party/companion/pako-2.0.3/LICENSE": {
    "bytes": 1104,
    "sha256": "a04665b3b2de56c66730c1f720f528175739e4104f79073614aa611da1e85539"
  },
  "third-party/companion/pako-2.0.3/SOURCE.md": {
    "bytes": 1633,
    "sha256": "1ea3abd9d996476bf16f20b14f72a339dac69b15fd3d9235b0800a8eb05d62a8"
  },
  "third-party/companion/pako-2.0.3/zlib-README": {
    "bytes": 2180,
    "sha256": "d8b499598e43d755ea8918448128259ff01820c50d94d5a48c8883d0a594ddb1"
  },
  "third-party/companion/dompurify-3.4.16/LICENSE": {
    "bytes": 11358,
    "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
  },
  "third-party/companion/dompurify-3.4.16/LICENSE-MPL": {
    "bytes": 16726,
    "sha256": "fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85"
  },
  "third-party/companion/dompurify-3.4.16/SOURCE.md": {
    "bytes": 1925,
    "sha256": "e132ed46f92916593bab00f4c315510b4a239c2b1504fd1bed6d8bed436c7f54"
  },
  "scripts/companion-bundled-license.mjs": {
    "bytes": 29780,
    "sha256": "87aeb035df2b36ba11c000212074b7313e3532df0bfb9064a6a6bb64dd310f6f"
  },
  "scripts/companion-bundled-license.test.mjs": {
    "bytes": 16852,
    "sha256": "9992306e0ae290d4adbb7076f301106995202f221faac07138b9e5a49483a025"
  }
}
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const { BUNDLED_LICENSE_PINS } = await import('./companion-bundled-license.mjs')
  const materialPaths = Object.keys(expected).filter(path => path.startsWith('third-party/companion/'))
  assert.equal(materialPaths.length, 22)
  assert.equal(Object.keys(expected).length, 24)
  assert.deepEqual(Object.keys(BUNDLED_LICENSE_PINS).map(path => 'third-party/companion/' + path).sort(), materialPaths.slice().sort())
  const files = {}
  for (const [path, identity] of Object.entries(expected)) {
    const bytes = readFileSync(new URL('../' + path, import.meta.url))
    assert.equal(bytes.length, identity.bytes, path)
    assert.equal(digest(bytes), identity.sha256, path)
    if (path.startsWith('third-party/companion/')) {
      assert.equal(BUNDLED_LICENSE_PINS[path.slice('third-party/companion/'.length)], identity.sha256, path)
    }
    files[path] = bytes
  }
  const index = JSON.parse(files['third-party/companion/index.json'])
  assert.equal(index.components.find(row => row.name === 'dompurify').version, '3.4.16')
  assert.equal(index.completeBundledInventory, false)
  assert.equal(index.releaseLicenseAcceptance, false)
  assert.equal(index.components.find(row => row.name === 'dompurify').independentUpstreamRetrievalVerified, false)
  const pending = [
    'third-party/companion/dompurify-3.4.15/LICENSE',
    'third-party/companion/dompurify-3.4.15/LICENSE-MPL',
    'third-party/companion/dompurify-3.4.15/SOURCE.md',
    'third-party/companion/dompurify-3.4.17/LICENSE',
    'third-party/companion/elkjs-0.10.2/future-source.json',
    'third-party/companion/pako-2.0.3/future-notice.txt',
    'third-party/companion/pako-1.0.11/future-notice.txt',
    'scripts/companion-bundled-license-future.mjs',
  ]
  for (const path of pending) files[path] = 'Synthetic unreviewed material neighbor\n'
  const actualPolicy = actualSelectionPolicy()
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy: actualPolicy })
  for (const path of Object.keys(expected)) {
    const rules = actualPolicy.rules.filter(rule => rule.path === path)
    assert.equal(rules.length, 1, path)
    assert.equal(rules[0].kind, 'file', path)
    assert.equal(rules[0].action, 'include', path)
    const entry = result.entries.find(entry => entry.path === path)
    assert.equal(entry.action, 'include', path)
    assert.equal(entry.bytes, expected[path].bytes, path)
    assert.deepEqual(entry.findings, [], path)
  }
  for (const path of pending) assert.equal(result.entries.find(entry => entry.path === path).action, 'review', path)
  assert.equal(result.classificationComplete, false)
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})


test('contributor entry and current authoring/native sources are selected without approving a release', t => {
  const selected = ['AGENTS.md', 'packages/studio/src/panel-drafts.ts', 'packages/studio/src/panel-preview.ts',
    'packages/skills-web-app/bundles/ai_agent_capabilities/skill.yaml',
    'packages/companion/src/windows-native-platform.mjs', 'packages/companion/src/windows-private-storage.mjs',
    'packages/companion/test/native-hook-package.test.mjs']
  const pending = ['AGENTS.future.md', 'scripts/future-host-probe.mjs']
  const files = Object.fromEntries([...selected, ...pending].map(path => [path, 'Synthetic portable source\n']))
  // Source selection never bypasses findings in an included product file.
  const privateHost = ['gitlab', 'alibaba-inc', 'com'].join('.')
  files['packages/companion/src/unsafe-example.mjs'] = `${privateHost}/internal\n`
  const result = inspectPublicSnapshot({ ...fixture(t, files), policy: actualSelectionPolicy() })
  for (const path of selected) assert.equal(result.entries.find(entry => entry.path === path).action, 'include', path)
  for (const path of pending) assert.equal(result.entries.find(entry => entry.path === path).action, 'review', path)
  assert.ok(result.entries.find(entry => entry.path === 'packages/companion/src/unsafe-example.mjs').findings.some(f => f.kind === 'private_source'))
  assert.equal(result.classificationComplete, false)
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.releaseApproved, false)
})
