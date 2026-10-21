import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import YAML from 'yaml'
import { validateReleaseVersion, validateReleaseManifest, validatePackInventory, verifyReleaseArchive, COMPANION_REPOSITORY } from './prepare-companion-release.mjs'
import { NATIVE_DONOR, stageNativeDonor } from './companion-release-native-donor.mjs'
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const version = '0.1.0-beta.19'
test('only explicit canonical beta versions reach the builder', () => {
  assert.equal(validateReleaseVersion(version), version)
  for (const value of [undefined, 'latest', 'beta', '1.0.0', '1.0.0-rc.1', '1.0.0-beta.01', '01.0.0-beta.1', '1.0.0-beta.1+build', '1.0.0-beta.1\n', '$(id)']) assert.throws(() => validateReleaseVersion(value))
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
test('workflow remains manual, default dry-run and exact Companion archive publishing', async () => {
  const text = await read('.github/workflows/publish-companion.yml'), workflow = YAML.parse(text)
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false)
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.type, 'boolean')
  assert.equal(workflow.on.workflow_dispatch.inputs.version.required, true)
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(Object.keys(workflow.jobs), ['dryrun', 'publish'])
  const job = workflow.jobs.dryrun
  assert.equal(job.permissions, undefined)
  assert.equal(job.if, "github.repository == 'alibaba-damo-academy/yugoo-design' && (inputs.publish != true || github.ref != 'refs/heads/main')")
  const publisher = workflow.jobs.publish
  assert.equal(publisher.if, "github.repository == 'alibaba-damo-academy/yugoo-design' && inputs.publish == true && github.ref == 'refs/heads/main'")
  assert.deepEqual(publisher.permissions, { contents: 'read', 'id-token': 'write' })
  // The exact expressions above use the shared JavaScript/GitHub boolean subset.
  // Exercise fork, branch, tag and explicit/default publication routing.
  for (const repository of ['alibaba-damo-academy/yugoo-design', 'example/fork']) {
    for (const ref of ['refs/heads/main', 'refs/heads/feature', 'refs/tags/v0.1.0-beta.19']) {
      for (const publish of [false, true]) {
        const selected = Object.entries(workflow.jobs).filter(([, row]) => new Function('github', 'inputs', `return (${row.if})`)({ repository, ref }, { publish })).map(([id]) => id)
        assert.deepEqual(selected, repository === 'example/fork' ? [] : [publish && ref === 'refs/heads/main' ? 'publish' : 'dryrun'])
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
      assert.equal(step.with['node-version'], '22.22.3')
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
  assert.equal(publish[0].if, "github.job == 'publish'")
  assert.equal(publish[0].env.RELEASE_TARBALL, '${{ steps.verify.outputs.tarball }}')
  assert.equal(publish[0].run, 'npm publish "$RELEASE_TARBALL" --access public --tag beta --registry=https://registry.npmjs.org')
  const rejection = job.steps.find(step => step.if?.includes("github.ref != 'refs/heads/main'"))
  assert.equal(rejection.if, "inputs.publish == true && github.ref != 'refs/heads/main'")
  assert.match(rejection.run, /exit 1/u)
  const install = job.steps.find(step => step.run?.includes('pnpm install --frozen-lockfile'))
  assert.match(install.run, /pnpm install --lockfile-only --strict-peer-dependencies --registry=https:\/\/registry.npmjs.org/u)
  assert.match(install.run, /pnpm install --frozen-lockfile --strict-peer-dependencies --registry=https:\/\/registry.npmjs.org/u)
  const prepare = job.steps.filter(step => step.run?.includes('prepare-companion-release.mjs prepare '))
  assert.equal(prepare.length, 1, 'Build and pack exactly once per selected job')
  assert.equal(prepare[0].env.RELEASE_VERSION, '${{ inputs.version }}')
  assert.equal(prepare[0].run, 'node --import tsx scripts/prepare-companion-release.mjs prepare "$RELEASE_VERSION" "$RUNNER_TEMP/companion-release"')
  const native = job.steps.find(step => step.run === 'node --test scripts/companion-native-git.test.mjs')
  assert.equal(native.env.YUGOO_NATIVE_GIT_ARTIFACT_ROOT, '${{ runner.temp }}/companion-release/native-artifacts')
  const verify = job.steps.find(step => step.id === 'verify')
  assert.equal(verify.run, 'node scripts/prepare-companion-release.mjs verify "$RUNNER_TEMP/companion-release/release-receipt.json"')
  assert.ok(job.steps.indexOf(rejection) < job.steps.indexOf(install))
  assert.ok(job.steps.indexOf(install) < job.steps.indexOf(prepare[0]))
  assert.ok(job.steps.indexOf(prepare[0]) < job.steps.indexOf(native))
  assert.ok(job.steps.indexOf(native) < job.steps.indexOf(verify))
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
