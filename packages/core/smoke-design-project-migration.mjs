import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesignProjectRegistry, parseDesignCommand, runDesignProjectCommand } from './lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-design-migration-'))
const knowledge = { provider: 'ladybug-wasm' }
try {
  const projectsRoot = join(root, 'projects')
  const stateRoot = join(root, 'state')
  const sourceRoot = join(root, 'legacy-project')
  await mkdir(join(sourceRoot, 'design_files', 'smart_questions'), { recursive: true })
  await mkdir(join(sourceRoot, 'design_files', 'unknown_bundle'), { recursive: true })
  const oldState = '{"legacy":true}\n'
  await writeFile(join(sourceRoot, 'design_files', 'smart_questions', 'smart_questions.json'), oldState)
  await writeFile(join(sourceRoot, 'design_files', 'unknown_bundle', 'unknown.json'), '{}\n')
  const oldMetadata = '{"legacy":true,"name":"Original name"}\n'
  await writeFile(join(sourceRoot, 'project.json'), oldMetadata)
  await mkdir(join(sourceRoot, '.git'))
  await writeFile(join(sourceRoot, '.git', 'history-marker'), 'source-only history\n')

  const registry = new DesignProjectRegistry({ projectsRoot, stateRoot })
  const template = await registry.create(
    'current',
    knowledge,
  )
  await registry.setKitPin(template.projectId, { name: 'web_app', version: '1.0' })
  assert.equal(registry.recover, undefined, 'the retired project API is not an alias')
  assert.equal(registry.inspectRecoverySource, undefined)
  assert.deepEqual(await registry.inspectMigrationSource(sourceRoot), { sourceRoot })
  await assert.rejects(registry.inspectMigrationSource('relative/source'), /source path must be absolute/)
  for (const path of [sourceRoot, template.root, join(template.root, 'project.json')]) {
    await assert.rejects(registry.inspectReconstructionSource(path), /use \/yugoo migrate/)
  }

  const migrated = await registry.migrate(
    sourceRoot,
    { knowledge, kit: { name: 'web_app', version: '1.0' } },
    ['smart_questions', 'flow_design'],
  )
  assert.equal(migrated.name, 'legacy-project-migrated')
  assert.notEqual(migrated.projectId, template.projectId)
  assert.notEqual(migrated.root, sourceRoot)
  assert.equal(migrated.sourceRoot, sourceRoot)
  assert.deepEqual(migrated.migratedBundles, ['smart_questions'])
  assert.equal(migrated.recoveredBundles, undefined)
  assert.equal(
    await readFile(join(migrated.designFilesRoot, 'smart_questions', 'smart_questions.json'), 'utf8'),
    oldState,
  )
  await assert.rejects(readFile(join(migrated.designFilesRoot, 'unknown_bundle', 'unknown.json'), 'utf8'), /ENOENT/)
  assert.equal((await registry.require(migrated.projectId)).kit?.name, 'web_app')
  assert.deepEqual(Object.keys((await registry.snapshot(migrated.projectId)).bundleStates), [])
  assert.equal(await readFile(join(sourceRoot, 'design_files', 'smart_questions', 'smart_questions.json'), 'utf8'), oldState)
  assert.equal(await readFile(join(sourceRoot, 'project.json'), 'utf8'), oldMetadata)
  assert.equal(await readFile(join(sourceRoot, '.git', 'history-marker'), 'utf8'), 'source-only history\n')
  await assert.rejects(readFile(join(migrated.root, '.git', 'history-marker')), /ENOENT/)
  assert.equal((await registry.require(template.projectId)).name, 'current', 'existing registered project names stay unchanged')
  const countBeforeRejection = (await registry.list()).length
  await assert.rejects(registry.migrate(sourceRoot,
    { knowledge, kit: { name: 'web_app', version: '1.0' } }, ['not_in_source']), /no Bundle directories/)
  assert.equal((await registry.list()).length, countBeforeRejection, 'no empty target is created for unrelated Bundles')

  const invocation = parseDesignCommand(`migrate ${sourceRoot}`)
  assert.equal(invocation?.verb, 'migrate')
  assert.equal(parseDesignCommand(`recover ${sourceRoot}`), undefined)
  const missing = await runDesignProjectCommand(parseDesignCommand('migrate'), { projects: {}, conversation: {} })
  assert.equal(missing.kind, 'error')
  assert.match(missing.text, /\/yugoo migrate/)
  const result = await runDesignProjectCommand(invocation, {
    projects: {
      async migrate(_reference, currentProjectId) {
        assert.equal(currentProjectId, template.projectId)
        return migrated
      },
      async snapshot() { return registry.snapshot(migrated.projectId) },
    },
    conversation: {
      async current() { return { projectId: template.projectId, revision: 1 } },
      async select() { return { revision: 2 } },
    },
  })
  assert.equal(result.kind, 'success')
  assert.match(result.conversationPrompt, /先对当前工作树运行现有 validator/)
  assert.match(result.conversationPrompt, /不要修改来源目录/)

  const unboundResult = await runDesignProjectCommand(invocation, {
    projects: {
      async migrate(_reference, currentProjectId) {
        assert.equal(currentProjectId, undefined)
        return migrated
      },
      async snapshot() { return registry.snapshot(migrated.projectId) },
    },
    conversation: {
      async current() { return undefined },
      async select() { return { revision: 1 } },
    },
  })
  assert.equal(unboundResult.kind, 'success')
  assert.match(unboundResult.text, /已创建迁移目标并打开/u)
  const second = await registry.migrate(sourceRoot,
    { knowledge, kit: { name: 'web_app', version: '1.0' } }, ['smart_questions'])
  assert.equal(second.name, 'legacy-project-migrated-2', 'a new migration never overwrites a prior target')
  assert.notEqual(second.projectId, migrated.projectId)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('DESIGN PROJECT MIGRATION OK')
