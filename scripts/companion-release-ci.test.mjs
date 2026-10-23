import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { satisfies } from 'semver'
import { validateReleaseVersion, selectCompanionRelease, validateReleaseManifest, validatePackInventory, verifyReleaseArchive, COMPANION_REPOSITORY } from './prepare-companion-release.mjs'
import { NATIVE_DONOR, stageNativeDonor } from './companion-release-native-donor.mjs'
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const version = '0.1.0-beta.19'
test('consumer checks reject output inside the checkout, including dot-dot-prefixed children', () => {
  const helper = fileURLToPath(new URL('./check-companion-node-runtime.mjs', import.meta.url))
  const tarball = fileURLToPath(import.meta.url)
  for (const output of [fileURLToPath(new URL('../', import.meta.url)), fileURLToPath(new URL('../..consumer-fixture', import.meta.url))]) {
    const result = spawnSync(process.execPath, [helper, tarball, version, output], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Install output must be outside the checkout/u)
  }
})
test('Node engines express the maintained minimum without excluding odd releases', async () => {
  const manifests = await Promise.all(['package.json', 'packages/git-native/package.json', 'docs/companion-npm-fixture-2026-09-30.json'].map(async path => JSON.parse(await read(path))))
  for (const manifest of manifests) {
    assert.equal(manifest.engines.node, '>=22.19.0')
    for (const node of ['22.19.0', '22.22.3', '23.0.0', '23.11.1', '24.0.0', '26.0.0']) assert.equal(satisfies(node, manifest.engines.node), true, node)
    for (const node of ['20.20.0', '22.0.0', '22.18.0']) assert.equal(satisfies(node, manifest.engines.node), false, node)
  }
})
test('only explicit canonical beta versions reach the builder', () => {
  assert.equal(validateReleaseVersion(version), version)
  for (const value of [undefined, 'latest', 'beta', '1.0.0', '1.0.0-rc.1', '1.0.0-beta.01', '01.0.0-beta.1', '1.0.0-beta.1+build', '1.0.0-beta.1\n', '$(id)']) assert.throws(() => validateReleaseVersion(value))
})
test('the single tracked version is authoritative for automatic and manual selection', async () => {
  const manifest = JSON.parse(await read('release/companion-version.json'))
  validateReleaseVersion(manifest.version)
  const fetchImpl = () => assert.fail('dry-run must not query publication state')
  for (const expectedVersion of [undefined, '', manifest.version]) {
    assert.deepEqual(await selectCompanionRelease({ manifest, expectedVersion, fetchImpl }), { version: manifest.version, skip: false })
  }
  for (const bad of [undefined, null, [], {}, { version: 'latest' }, { ...manifest, publish: true }]) {
    await assert.rejects(selectCompanionRelease({ manifest: bad, fetchImpl }))
  }
  for (const expectedVersion of ['latest', '$(id)', '999.0.0-beta.1']) {
    await assert.rejects(selectCompanionRelease({ manifest, expectedVersion, fetchImpl }))
  }
  await assert.rejects(selectCompanionRelease({ manifest, checkPublished: 'true', fetchImpl }))
})
test('publication lookup skips only an exact existing version and only 404 means absent', async () => {
  const manifest = { version }, calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return { status: 200, json: async () => ({ name: '@yugoo-design/companion', version }) }
  }
  assert.deepEqual(await selectCompanionRelease({ manifest, checkPublished: true, fetchImpl }), { version, skip: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `https://registry.npmjs.org/@yugoo-design%2fcompanion/${version}`)
  assert.equal(calls[0].options.redirect, 'error')
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  assert.deepEqual(await selectCompanionRelease({ manifest, checkPublished: true,
    fetchImpl: async () => ({ status: 404, json: () => assert.fail('404 body is not package metadata') }) }), { version, skip: false })
  for (const status of [301, 401, 403, 429, 500, 503]) {
    await assert.rejects(selectCompanionRelease({ manifest, checkPublished: true,
      fetchImpl: async () => ({ status }) }), /Registry version lookup failed/)
  }
  await assert.rejects(selectCompanionRelease({ manifest, checkPublished: true,
    fetchImpl: async () => { throw new Error('network unavailable') } }), /network unavailable/)
  await assert.rejects(selectCompanionRelease({ manifest, checkPublished: true,
    fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('bad metadata JSON') } }) }), /bad metadata JSON/)
  for (const published of [{}, { name: '@foreign/package', version }, { name: '@yugoo-design/companion', version: '0.1.0-beta.16' }]) {
    await assert.rejects(selectCompanionRelease({ manifest, checkPublished: true,
      fetchImpl: async () => ({ status: 200, json: async () => published }) }))
  }
})
test('publication tags must exactly match the tracked version before registry lookup', async () => {
  const manifest = { version }, releaseRef = `refs/tags/v${version}`
  const fetchImpl = () => assert.fail('invalid tags must never query publication state')
  assert.deepEqual(await selectCompanionRelease({ manifest, releaseRef, requireTag: true }), { version, skip: false })
  assert.deepEqual(await selectCompanionRelease({ manifest, releaseRef: 'refs/heads/feature' }), { version, skip: false })
  for (const bad of [undefined, '', 'refs/heads/main', 'refs/tags/v0.1.0-beta.18', `refs/tags/${version}`, releaseRef + '\n', '$(id)', null, 1]) {
    await assert.rejects(selectCompanionRelease({ manifest, releaseRef: bad, requireTag: true, checkPublished: true, fetchImpl }))
  }
  await assert.rejects(selectCompanionRelease({ manifest, releaseRef, requireTag: 'true', fetchImpl }))
  await assert.rejects(selectCompanionRelease({ manifest, releaseRef: 'refs/tags/other', fetchImpl }))
  assert.deepEqual(await selectCompanionRelease({ manifest, releaseRef, requireTag: true, checkPublished: true,
    fetchImpl: async () => ({ status: 404 }) }), { version, skip: false })
})
test('the pre-install selector reads the tracked file and writes validated action outputs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-ci-select-')); t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = JSON.parse(await read('release/companion-version.json')), output = join(root, 'outputs')
  const script = fileURLToPath(new URL('./prepare-companion-release.mjs', import.meta.url))
  const env = { ...process.env, EXPECTED_RELEASE_VERSION: manifest.version, CHECK_RELEASE_PUBLISHED: 'false', REQUIRE_RELEASE_TAG: 'false', RELEASE_REF: 'refs/heads/main', GITHUB_OUTPUT: output }
  const selected = spawnSync(process.execPath, [script, 'select'], { env, cwd: root, encoding: 'utf8' })
  assert.equal(selected.status, 0, selected.stderr)
  assert.equal(JSON.parse(selected.stdout).version, manifest.version)
  assert.equal(await readFile(output, 'utf8'), `version=${manifest.version}\nskip=false\n`)
  for (const extra of [{ EXPECTED_RELEASE_VERSION: '$(id)' }, { CHECK_RELEASE_PUBLISHED: 'yes' }, { REQUIRE_RELEASE_TAG: 'yes' }, { REQUIRE_RELEASE_TAG: 'true' }, { RELEASE_REF: 'refs/tags/v999.0.0-beta.1' }]) {
    const rejected = spawnSync(process.execPath, [script, 'select'], { env: { ...env, ...extra }, cwd: root, encoding: 'utf8' })
    assert.equal(rejected.status, 1)
    assert.equal(await readFile(output, 'utf8'), `version=${manifest.version}\nskip=false\n`, 'failed selection cannot emit new outputs')
  }
})
test('release package identity and repository come from the maintained template', async () => {
  const template = JSON.parse(await read('docs/companion-npm-fixture-2026-09-30.json'))
  const manifest = { ...template, name: '@yugoo-design/companion', version, dependencies: { ...template.dependencies, '@ladybugdb/wasm-core': '0.21.1' }, publishConfig: { access: 'public', tag: 'beta' } }
  validateReleaseManifest(manifest, version)
  for (const change of [{ name: '@yugoo-design/dsh-design-core' }, { version: '0.1.0-beta.16' }, { repository: { type: 'git', url: 'git+https://example.invalid/private.git' } }, { publishConfig: { access: 'public', tag: 'latest' } }, { scripts: { prepublishOnly: 'unexpected' } }]) assert.throws(() => validateReleaseManifest({ ...manifest, ...change }, version))
})
test('pack cannot omit/add files or change their byte sizes', () => {
  const pack = { name: '@yugoo-design/companion', version, filename: `yugoo-design-companion-${version}.tgz`, files: [{ path: 'package.json', size: 10 }] }
  const inputs = { 'package.json': { bytes: 10 } }
  validatePackInventory(pack, inputs, version)
  for (const files of [[], [{ path: 'package.json', size: 11 }], [...pack.files, { path: '.env', size: 1 }]]) assert.throws(() => validatePackInventory({ ...pack, files }, inputs, version))
})
test('archive guard rejects modification or an unexpected tarball path', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-ci-archive-')); t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = Buffer.from('synthetic archive identity; not an installable tarball')
  const tarball = join(root, `yugoo-design-companion-${version}.tgz`), file = join(root, 'release-receipt.json')
  const receipt = { scope: 'companion-same-source-build-and-pack', version, published: false, tarball, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }
  await writeFile(tarball, bytes); await writeFile(file, JSON.stringify(receipt)); await verifyReleaseArchive(file)
  const relocated = join(root, 'download'); await mkdir(relocated)
  await writeFile(join(relocated, 'release-receipt.json'), JSON.stringify(receipt))
  await writeFile(join(relocated, `yugoo-design-companion-${version}.tgz`), bytes)
  const result = await verifyReleaseArchive(join(relocated, 'release-receipt.json'), { archiveDir: relocated })
  assert.equal(result.tarball, join(relocated, `yugoo-design-companion-${version}.tgz`))
  assert.equal(result.preparedTarball, tarball)
  await writeFile(result.tarball, Buffer.alloc(bytes.length))
  await assert.rejects(verifyReleaseArchive(join(relocated, 'release-receipt.json'), { archiveDir: relocated }), /archive changed/)
  await writeFile(tarball, Buffer.alloc(bytes.length)); await assert.rejects(verifyReleaseArchive(file), /archive changed/)
  await writeFile(file, JSON.stringify({ ...receipt, tarball: join(root, 'other.tgz') })); await assert.rejects(verifyReleaseArchive(file))
})
test('donor size/integrity failure writes no artifact directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-ci-donor-')); t.after(() => rm(root, { recursive: true, force: true }))
  const destination = join(root, 'artifacts')
  for (const archive of [Buffer.from('partial donor'), Buffer.alloc(NATIVE_DONOR.bytes)]) await assert.rejects(stageNativeDonor({ workspace: root, destination, archive }), /archive (size|integrity) changed/)
  await assert.rejects(access(destination), { code: 'ENOENT' })
})
test('only matching beta tag pushes publish automatically; manual dry-run and exact archive guards remain', async () => {
  const text = await read('.github/workflows/publish-companion.yml'), workflow = YAML.parse(text)
  assert.deepEqual(Object.keys(workflow.on), ['push', 'workflow_dispatch'])
  assert.deepEqual(workflow.on.push, { tags: ['v*-beta.*'] })
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false)
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.type, 'boolean')
  assert.equal(workflow.on.workflow_dispatch.inputs.version.required, false)
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(Object.keys(workflow.jobs), ['dryrun', 'publish'])
  const job = workflow.jobs.dryrun
  assert.equal(job.permissions, undefined)
  assert.equal(job.if, "github.repository == 'alibaba-damo-academy/yugoo-design' && github.event_name == 'workflow_dispatch' && (inputs.publish != true || !startsWith(github.ref, 'refs/tags/v'))")
  const publisher = workflow.jobs.publish
  assert.equal(publisher.if, "github.repository == 'alibaba-damo-academy/yugoo-design' && startsWith(github.ref, 'refs/tags/v') && (github.event_name == 'push' || github.event_name == 'workflow_dispatch' && inputs.publish == true)")
  assert.deepEqual(publisher.permissions, { contents: 'read', 'id-token': 'write' })
  // The exact expressions above use the shared JavaScript/GitHub boolean subset.
  // Exercise fork, branch, tag and explicit/default publication routing.
  for (const repository of ['alibaba-damo-academy/yugoo-design', 'example/fork']) {
    for (const ref of ['refs/heads/main', 'refs/heads/feature', 'refs/tags/v0.1.0-beta.19', 'refs/tags/v999.0.0-beta.1', 'refs/tags/other']) {
      for (const event_name of ['push', 'workflow_dispatch', 'pull_request']) {
        for (const publish of [undefined, false, true]) {
          const selected = Object.entries(workflow.jobs).filter(([, row]) => new Function('github', 'inputs', 'startsWith', `return (${row.if})`)({ repository, ref, event_name }, { publish }, (value, prefix) => value.startsWith(prefix))).map(([id]) => id)
          const expected = repository === 'example/fork' ? [] : event_name === 'workflow_dispatch'
            ? [publish && ref.startsWith('refs/tags/v') ? 'publish' : 'dryrun'] : event_name === 'push' && ref.startsWith('refs/tags/v') ? ['publish'] : []
          assert.deepEqual(selected, expected)
        }
      }
    }
  }
  assert.deepEqual(publisher.steps, job.steps, 'Use the same steps in the mutually exclusive jobs')
  assert.deepEqual(publisher.env, job.env)
  for (const row of [job, publisher]) {
    assert.equal(row.needs, undefined)
    assert.equal(row['runs-on'], 'ubuntu-24.04')
    assert.equal(row['timeout-minutes'], 45)
  }
  assert.doesNotMatch(text, /actions\/(?:upload-artifact|download-artifact|cache)@/u)
  const actionVersions = new Map([
    ['actions/checkout', 'v7.0.1'], ['actions/setup-node', 'v7.1.0'],
    ['pnpm/action-setup', 'v6.1.0'],
  ])
  const actions = [...job.steps, ...publisher.steps].filter(step => step.uses)
  for (const step of actions) {
    const [action, version] = step.uses.split('@')
    assert.equal(version, actionVersions.get(action), 'Use the reviewed Node24 Action release')
    if (action === 'actions/setup-node') {
      assert.ok(['22.22.3', '24.22.1'].includes(step.with['node-version']))
      assert.equal(step.with['package-manager-cache'], false)
    }
    if (action === 'pnpm/action-setup') {
      assert.equal(step.with.version, '11.7.0')
      assert.equal(step.with.run_install, false)
      assert.equal(step.with.cache, false)
    }
  }
  assert.equal(new Set(actions.map(step => step.uses.split('@')[0])).size, actionVersions.size)
  assert.ok([job, publisher].every(row => row.steps.some(step => step.run?.includes('npm install --global npm@11.21.0'))))
  const publish = publisher.steps.filter(x => x.run?.includes('npm publish'))
  assert.equal(publish.length, 1)
  assert.equal(publish[0].if, "github.job == 'publish' && steps.release.outputs.skip != 'true'")
  assert.equal(publish[0].env.RELEASE_TARBALL, '${{ steps.verify.outputs.tarball }}')
  assert.equal(publish[0].run, 'npm publish "$RELEASE_TARBALL" --access public --tag beta --registry=https://registry.npmjs.org')
  const rejection = job.steps.find(step => step.if?.includes("!startsWith(github.ref, 'refs/tags/v')"))
  assert.equal(rejection.if, "inputs.publish == true && !startsWith(github.ref, 'refs/tags/v')")
  assert.match(rejection.run, /exit 1/u)
  const ancestry = job.steps.find(step => step.run === 'git merge-base --is-ancestor HEAD origin/main')
  assert.equal(ancestry.if, "github.job == 'publish' && steps.release.outputs.skip != 'true'")
  assert.equal(job.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0)
  const install = job.steps.find(step => step.run?.includes('pnpm install --frozen-lockfile'))
  assert.match(install.run, /pnpm install --lockfile-only --strict-peer-dependencies --registry=https:\/\/registry.npmjs.org/u)
  assert.match(install.run, /pnpm install --frozen-lockfile --strict-peer-dependencies --registry=https:\/\/registry.npmjs.org/u)
  const prepare = job.steps.filter(step => step.run?.includes('prepare-companion-release.mjs prepare '))
  assert.equal(prepare.length, 1, 'Build and pack exactly once per selected job')
  assert.equal(prepare[0].env.RELEASE_VERSION, '${{ steps.release.outputs.version }}')
  assert.equal(prepare[0].run, 'node --import tsx scripts/prepare-companion-release.mjs prepare "$RELEASE_VERSION" "$RUNNER_TEMP/companion-release"')
  const native = job.steps.find(step => step.run === 'node --test scripts/companion-native-git.test.mjs')
  assert.equal(native.env.YUGOO_NATIVE_GIT_ARTIFACT_ROOT, '${{ runner.temp }}/companion-release/native-artifacts')
  const verify = job.steps.find(step => step.id === 'verify')
  assert.equal(verify.run, 'node scripts/prepare-companion-release.mjs verify "$RUNNER_TEMP/companion-release/release-receipt.json"')
  const selector = job.steps.find(step => step.id === 'release')
  assert.equal(selector.run, 'node scripts/prepare-companion-release.mjs select')
  assert.equal(selector.env.RELEASE_REF, '${{ github.ref }}')
  assert.equal(selector.env.REQUIRE_RELEASE_TAG, "${{ github.job == 'publish' }}")
  assert.equal(selector.env.EXPECTED_RELEASE_VERSION, '${{ inputs.version }}')
  assert.equal(selector.env.CHECK_RELEASE_PUBLISHED, "${{ github.job == 'publish' }}")
  assert.ok(job.steps.indexOf(selector) < job.steps.indexOf(install))
  for (const step of job.steps.filter(step => step.run && ![selector, rejection, ancestry, publish[0]].includes(step))) {
    assert.equal(step.if, "steps.release.outputs.skip != 'true'", 'published versions skip all preparation/install steps')
  }
  assert.ok(job.steps.indexOf(rejection) < job.steps.indexOf(install))
  assert.ok(job.steps.indexOf(install) < job.steps.indexOf(prepare[0]))
  assert.ok(job.steps.indexOf(prepare[0]) < job.steps.indexOf(native))
  assert.ok(job.steps.indexOf(native) < job.steps.indexOf(verify))
  const runtime = job.steps.filter(step => step.run?.includes('check-companion-node-runtime.mjs'))
  assert.equal(runtime.length, 2)
  for (const [index, major] of [22, 24].entries()) {
    assert.equal(runtime[index].env.RELEASE_TARBALL, '${{ steps.verify.outputs.tarball }}')
    assert.equal(runtime[index].env.RELEASE_VERSION, '${{ steps.release.outputs.version }}')
    assert.equal(runtime[index].run, `node scripts/check-companion-node-runtime.mjs \"$RELEASE_TARBALL\" \"$RELEASE_VERSION\" \"$RUNNER_TEMP/companion-node${major}\"`)
    assert.ok(job.steps.indexOf(verify) < job.steps.indexOf(runtime[index]))
    assert.ok(job.steps.indexOf(runtime[index]) < job.steps.indexOf(publish[0]))
  }
  assert.deepEqual(job.steps.filter(step => step.uses?.startsWith('actions/setup-node@')).map(step => step.with['node-version']), ['22.22.3', '24.22.1', '22.22.3'])
  assert.ok(job.steps.indexOf(ancestry) < job.steps.indexOf(install))
  assert.ok(job.steps.indexOf(verify) < job.steps.indexOf(publish[0]))
  assert.doesNotMatch(text, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.|--workspaces|--ignore-scripts|continue-on-error/u)
  for (const step of [...job.steps, ...publisher.steps].filter(x => x.run)) assert.ok(!step.run.includes('${{ inputs.version }}'), 'Version must enter via env, never shell interpolation')
})
test('only reviewed exact native dependency versions are permitted; denials survive', async () => {
  const { allowBuilds } = YAML.parse(await read('pnpm-workspace.yaml'))
  for (const name of ['@deepseek-ai/dsh-subprocess-local@0.2.0-rc.2', 'koffi@3.1.1', 'node-pty@1.2.0-beta.15', 'esbuild@0.28.2']) assert.equal(allowBuilds[name], true)
  for (const name of ['@deepseek-ai/dsh-subprocess-local', 'koffi', 'node-pty', 'koffi@3.1.2', 'node-pty@1.2.0-beta.16', '@deepseek-ai/dsh-subprocess-local@0.2.0-rc.3']) assert.equal(allowBuilds[name], undefined)
  for (const name of ['onnxruntime-node', 'protobufjs', 'sharp']) assert.equal(allowBuilds[name], false)
})
