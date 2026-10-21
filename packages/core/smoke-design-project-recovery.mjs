import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesignProjectRegistry, parseDesignCommand, runDesignProjectCommand } from './lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-design-recovery-'))
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

  const registry = new DesignProjectRegistry({ projectsRoot, stateRoot })
  const template = await registry.create(
    'current',
    knowledge,
  )
  await registry.setKitPin(template.projectId, { name: 'web_app', version: '1.0' })

  const recovered = await registry.recover(
    sourceRoot,
    { knowledge, kit: { name: 'web_app', version: '1.0' } },
    ['smart_questions', 'flow_design'],
  )
  assert.equal(recovered.name, 'legacy-project-recovered')
  assert.deepEqual(recovered.recoveredBundles, ['smart_questions'])
  assert.equal(
    await readFile(join(recovered.designFilesRoot, 'smart_questions', 'smart_questions.json'), 'utf8'),
    oldState,
  )
  await assert.rejects(readFile(join(recovered.designFilesRoot, 'unknown_bundle', 'unknown.json'), 'utf8'), /ENOENT/)
  assert.equal((await registry.require(recovered.projectId)).kit?.name, 'web_app')
  assert.deepEqual(Object.keys((await registry.snapshot(recovered.projectId)).bundleStates), [])
  assert.equal(await readFile(join(sourceRoot, 'design_files', 'smart_questions', 'smart_questions.json'), 'utf8'), oldState)

  const invocation = parseDesignCommand(`/design recover ${sourceRoot}`.replace('/design ', ''))
  assert.equal(invocation?.verb, 'recover')
  const result = await runDesignProjectCommand(invocation, {
    projects: {
      async recover(_reference, currentProjectId) {
        assert.equal(currentProjectId, template.projectId)
        return recovered
      },
      async snapshot() { return registry.snapshot(recovered.projectId) },
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
      async recover(_reference, currentProjectId) {
        assert.equal(currentProjectId, undefined)
        return recovered
      },
      async snapshot() { return registry.snapshot(recovered.projectId) },
    },
    conversation: {
      async current() { return undefined },
      async select() { return { revision: 1 } },
    },
  })
  assert.equal(unboundResult.kind, 'success')
  assert.match(unboundResult.text, /已创建恢复目标并打开/u)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('DESIGN PROJECT RECOVERY OK')
