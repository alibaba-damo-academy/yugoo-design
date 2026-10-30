import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { stringify } from 'yaml'
import { DesignProjectManager } from '../../core/lib/index.js'
import { writeContentBundle, writeContentCatalog } from '../../core/test/fixtures/content-catalog.mjs'
import { createCompanionContentLibrary } from '../src/content-library.mjs'
import { companionFs, openCompanionProject } from '../src/project.mjs'
import { createCompanionStudio } from '../src/studio.mjs'

const execute = promisify(execFile)
const cliEntry = fileURLToPath(new URL('../src/plugin-cli.mjs', import.meta.url))

function bundleFiles(marker) {
  return {
    'schema.yaml': stringify({ type: 'object', required: ['summary', marker],
      properties: { summary: { type: 'string' }, [marker]: { type: 'string' } } }),
    'validation.yaml': stringify({ skill: 'alpha', rules: [{ id: marker, scope: ['completion'], code: `alpha.${marker}`,
      message: `The exact version requires ${marker}.`, check: { non_empty_string: marker } }] }),
  }
}

async function libraryFixture(kitRoot, stateRoot) {
  const library = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot })
  const kit = await library.loadInstalled()
  return { library, kit, studio: await createCompanionStudio(kit, kitRoot, stateRoot, library) }
}

async function prepareProject(root, { kitRoot, stateRoot, pin, marker, existing = false }) {
  const projectRoot = join(root, 'design project')
  if (!existing) await new DesignProjectManager().create({ root: projectRoot, name: 'Exact validation context',
    knowledge: { provider: 'ladybug-wasm' }, kit: pin })
  const api = await openCompanionProject({ projectRoot, kitRoot, stateRoot, statusEntryPath: cliEntry,
    connection: { host: 'workbuddy', threadId: 'validation-context-session' } })
  const prepared = await api.prepareBundle({ skill: 'alpha' })
  assert.deepEqual(prepared.kit, { name: pin.name, version: pin.version })
  const validation = prepared.executionContract.validation
  assert.ok(validation, 'a fully specified project context exposes the existing CLI preflight')
  assert.equal(validation.executable, process.execPath)
  for (const [flag, value] of [['--kit', api.kit.sourceRoot], ['--state-root', stateRoot], ['--project', projectRoot]]) {
    assert.equal(validation.argv[validation.argv.indexOf(flag) + 1], value, `${flag} retains the current project context`)
  }
  await mkdir(prepared.executionContract.directory, { recursive: true })
  await writeFile(prepared.executionContract.canonicalFile, JSON.stringify({ summary: 'Version-pinned evidence', [marker]: 'present' }))
  return { api, prepared, validation }
}

async function validate(validation, stateRoot) {
  const argv = [...validation.argv]
  if (stateRoot !== undefined) argv[argv.indexOf('--state-root') + 1] = stateRoot
  // This is the actual source CLI in a fresh process, not a validator stub or a
  // packaged-install assertion. The source-only TS loader precedes literal argv.
  const result = await execute(validation.executable, ['--experimental-transform-types', ...argv], { timeout: 30_000 })
  return JSON.parse(result.stdout)
}

test('native validation CLI reopens a project-local Kit independently of the original content store', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-imported-validation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = await writeContentCatalog(join(root, 'installed package'), { name: 'validation_base', version: '1.0',
    bundles: [{ name: 'alpha', version: '1.0', files: bundleFiles('base_marker') }] })
  const donor = await writeContentCatalog(join(root, 'author package'), { name: 'imported_validation', version: '2.4',
    bundles: [{ name: 'alpha', version: '2.0', files: bundleFiles('imported_marker') }] })
  const stateRoot = join(root, 'receiver state')
  const receiver = await libraryFixture(base.root, stateRoot)
  const authorState = join(root, 'author state')
  const author = await libraryFixture(donor.root, authorState)
  const source = await author.studio.exportContentArchive({ kind: 'kit', pin: { name: author.kit.name, version: author.kit.version },
    provenance: { source: 'fixture:independent-author', license: 'Synthetic fixture only' } })
  const archive = receiver.studio.readArchive({ source })
  const imported = await receiver.studio.importInstanceSources({ kind: archive.kind, files: archive.files.map(({ path, base64 }) => ({ path, base64 })), title: archive.title })
  await rm(donor.root, { recursive: true })
  await rm(authorState, { recursive: true })

  const pin = imported.kit
  await new DesignProjectManager().create({ root: join(root, 'design project'), name: 'Imported current Kit', knowledge: { provider: 'ladybug-wasm' }, kit: pin })
  const selected = await receiver.library.loadCurrentKit(pin)
  const { ensureProjectKit } = await import('../../core/lib/index.js')
  await ensureProjectKit(join(root, 'design project'), { loadSource: async () => selected })
  const { api, prepared, validation } = await prepareProject(root, { kitRoot: base.root, stateRoot, pin, marker: 'imported_marker', existing: true })
  assert.equal(api.kit.skills[0].version, '2.0')
  assert.ok(prepared.resources.startsWith(api.project.root), 'the method and validator use the independent project source')
  assert.deepEqual(await validate(validation), { valid: true, skill: 'alpha', issues: [] })
  assert.deepEqual(await validate(validation, join(root, 'isolated fresh state')), { valid: true, skill: 'alpha', issues: [] })
})

test('native validation CLI materializes the effective Bundle override instead of validating the Kit default', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-override-validation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = await writeContentCatalog(join(root, 'installed package'), { name: 'override_validation', version: '1.0',
    bundles: [{ name: 'alpha', version: '1.0', files: bundleFiles('base_marker') }] })
  const stateRoot = join(root, 'receiver state')
  const receiver = await libraryFixture(base.root, stateRoot)
  const overrideRoot = join(root, 'trusted alpha override')
  await writeContentBundle(overrideRoot, { name: 'alpha', version: '1.1', files: bundleFiles('override_marker') })
  // A retained new version from the same explicit trusted source preserves the
  // Core provenance guard; an unrelated import cannot borrow that authority.
  await receiver.library.store.retainBundle(overrideRoot, { sourceId: 'companion:explicit-kit' })
  await rm(overrideRoot, { recursive: true })

  const pin = { name: 'override_validation', version: '1.0', bundles: { alpha: '1.1' } }
  const { api, prepared, validation } = await prepareProject(root, { kitRoot: base.root, stateRoot, pin, marker: 'override_marker' })
  assert.equal(api.kit.skills[0].version, '1.1')
  assert.equal(prepared.version, '1.1')
  assert.ok(prepared.resources.startsWith(api.project.root))
  assert.deepEqual(await validate(validation), { valid: true, skill: 'alpha', issues: [] })
  assert.deepEqual(await validate(validation, join(root, 'isolated fresh state')), { valid: true, skill: 'alpha', issues: [] })
})
