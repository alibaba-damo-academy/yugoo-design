/** Focused real-filesystem smoke for the persistent Design Project registry. */
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { DesignProjectManager, DesignProjectRegistry } from '../packages/core/lib/index.js'

const knowledge = { provider: 'test-embedded' }

const ids = {
  alpha: '11111111-1111-4111-8111-111111111111',
  beta: '22222222-2222-4222-8222-222222222222',
  external: '33333333-3333-4333-8333-333333333333',
  duplicateName: '44444444-4444-4444-8444-444444444444',
  duplicateId: '11111111-1111-4111-8111-111111111111',
  corruptA: '55555555-5555-4555-8555-555555555555',
  corruptB: '66666666-6666-4666-8666-666666666666',
}

function managerFor(...createdIds) {
  let index = 0
  return new DesignProjectManager({
    createId: () => {
      const id = createdIds[index]
      index += 1
      if (id === undefined) throw new Error('smoke: exhausted deterministic project ids')
      return id
    },
    now: () => new Date('2026-08-24T00:00:00.000Z'),
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-design-project-registry-'))
try {
  const projectsRoot = join(root, 'managed-projects')
  const stateRoot = join(root, 'runtime-state')
  const registry = new DesignProjectRegistry({
    projectsRoot,
    stateRoot,
    manager: managerFor(ids.alpha, ids.beta),
  })

  // Serialized concurrent creation cannot lose either registry entry.
  const [alpha, beta] = await Promise.all([
    registry.create('研发 / Alpha', knowledge),
    registry.create('Beta', knowledge),
  ])
  assert.equal(alpha.projectId, ids.alpha)
  assert.deepEqual(alpha.knowledge, knowledge)
  assert.equal(beta.projectId, ids.beta)
  assert.match(basename(alpha.root), /^[a-z0-9-]+-[0-9a-f-]{36}$/u)
  assert.equal(relative(projectsRoot, alpha.root).startsWith('..'), false)
  assert.equal(relative(alpha.root, alpha.stateRoot).startsWith('..'), true, 'runtime state must live outside the project')
  assert.equal(alpha.stateRoot, join(stateRoot, 'projects', ids.alpha))
  assert.equal(await exists(alpha.stateRoot), false, 'exposing runtime state must not create project-local process data')

  const registryJson = JSON.parse(await readFile(join(stateRoot, 'design-projects.json'), 'utf8'))
  assert.deepEqual(Object.keys(registryJson), ['formatVersion', 'projects'])
  assert.equal(registryJson.formatVersion, 1)
  assert.deepEqual(Object.keys(registryJson.projects).sort(), [ids.alpha, ids.beta])
  assert.equal(registryJson.projects[ids.alpha], alpha.root)
  assert.equal(registryJson.projects[ids.beta], beta.root)
  assert.deepEqual((await readdir(stateRoot)).filter(name => name.endsWith('.tmp')), [], 'atomic writes must leave no temp file')

  assert.equal((await registry.open(ids.alpha)).root, alpha.root, 'id resolves first')
  assert.equal((await registry.open('研发 / Alpha')).projectId, ids.alpha, 'unique registered name resolves second')
  assert.equal((await registry.require(ids.beta)).name, 'Beta')
  assert.deepEqual((await registry.list()).map(project => project.name), ['Beta', '研发 / Alpha'])
  await assert.rejects(registry.create('Beta', knowledge), /duplicate registered name/u)
  await assert.rejects(registry.open('./relative-project'), /path must be absolute/u)
  await assert.rejects(registry.require('not-an-id'), /invalid Design Project id/u)

  const clean = await registry.status(ids.alpha)
  assert.equal(clean.gitClean, true)
  assert.match(clean.lastCheckpoint, /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u)
  const version = '1.0'
  const pinned = await registry.setKitPin(ids.alpha, { name: 'web_app', version })
  assert.deepEqual(pinned.kit, { name: 'web_app', version })
  const pinnedStatus = await registry.status(ids.alpha)
  assert.notEqual(pinnedStatus.lastCheckpoint, clean.lastCheckpoint, 'Kit pin must create a project checkpoint')
  assert.equal(pinnedStatus.gitClean, true)
  assert.deepEqual(JSON.parse(await readFile(join(alpha.root, 'project.json'), 'utf8')).kit, { name: 'web_app', version })
  await registry.setKitPin(ids.alpha, { name: 'web_app', version })
  assert.equal((await registry.status(ids.alpha)).lastCheckpoint, pinnedStatus.lastCheckpoint, 'same Kit pin must be a no-op')

  const betaProjectJson = join(beta.root, 'project.json')
  const betaMetadata = await readFile(betaProjectJson, 'utf8')
  await writeFile(betaProjectJson, `${betaMetadata.trimEnd()} \n`)
  await assert.rejects(
    registry.setKitPin(ids.beta, { name: 'web_app', version }),
    /project\.json has uncommitted changes/u,
  )
  await writeFile(betaProjectJson, betaMetadata)

  await writeFile(join(alpha.designFilesRoot, 'draft.txt'), 'dirty\n')
  const closed = await registry.close(ids.alpha)
  assert.equal(closed.gitClean, false)
  assert.match(closed.porcelain, /design_files\/draft\.txt/u)
  assert.equal(await exists(alpha.root), true, 'close must not delete the project')
  assert.equal((await registry.require(ids.alpha)).root, alpha.root, 'close must not unregister the project')

  // A new registry instance reconstructs the same canonical records.
  const restarted = new DesignProjectRegistry({ projectsRoot, stateRoot })
  assert.deepEqual((await restarted.list()).map(project => project.projectId).sort(), [ids.alpha, ids.beta])

  // Absolute unregistered paths validate and register; id and name conflicts fail loud.
  const externalManager = managerFor(ids.external)
  const external = await externalManager.create({ root: join(root, 'external'), name: 'External', knowledge })
  const registeredExternal = await registry.open(external.root)
  assert.equal(registeredExternal.projectId, ids.external)
  assert.equal((await registry.open('External')).root, external.root)

  const duplicateName = await managerFor(ids.duplicateName)
    .create({ root: join(root, 'duplicate-name'), name: 'External', knowledge })
  await assert.rejects(registry.open(duplicateName.root), /duplicate registered name/u)

  const duplicateId = await managerFor(ids.duplicateId)
    .create({ root: join(root, 'duplicate-id'), name: 'Different identity root', knowledge })
  await assert.rejects(registry.open(duplicateId.root), /duplicate project id/u)

  // A registered key never tolerates a changed project.json identity.
  const alphaProjectJson = join(alpha.root, 'project.json')
  const originalAlphaMetadata = await readFile(alphaProjectJson, 'utf8')
  const changedAlphaMetadata = { ...JSON.parse(originalAlphaMetadata), id: ids.corruptA }
  await writeFile(alphaProjectJson, `${JSON.stringify(changedAlphaMetadata, null, 2)}\n`)
  await assert.rejects(registry.require(ids.alpha), /does not match registered id/u)
  await writeFile(alphaProjectJson, originalAlphaMetadata)

  // Strict persisted data rejects duplicate roots, duplicate names, and unknown format fields.
  const corruptRoot = join(root, 'corrupt-world')
  const corruptProjects = join(corruptRoot, 'projects')
  const corruptState = join(corruptRoot, 'state')
  await mkdir(corruptProjects, { recursive: true })
  const corruptManager = managerFor(ids.corruptA, ids.corruptB)
  const corruptA = await corruptManager.create({ root: join(corruptProjects, 'a'), name: 'Same', knowledge })
  const corruptB = await corruptManager.create({ root: join(corruptProjects, 'b'), name: 'Same', knowledge })
  await mkdir(corruptState, { recursive: true })
  const corruptFile = join(corruptState, 'design-projects.json')
  await writeFile(corruptFile, `${JSON.stringify({
    formatVersion: 1,
    projects: { [ids.corruptA]: corruptA.root, [ids.corruptB]: corruptB.root },
  })}\n`)
  const corruptRegistry = new DesignProjectRegistry({ projectsRoot: corruptProjects, stateRoot: corruptState })
  await assert.rejects(corruptRegistry.list(), /duplicate registered name/u)

  await writeFile(corruptFile, `${JSON.stringify({
    formatVersion: 1,
    projects: { [ids.corruptA]: corruptA.root, [ids.corruptB]: corruptA.root },
  })}\n`)
  await assert.rejects(corruptRegistry.list(), /duplicate registered root/u)

  await writeFile(corruptFile, `${JSON.stringify({ formatVersion: 2, projects: {}, extra: true })}\n`)
  await assert.rejects(corruptRegistry.list(), /invalid fields|unsupported format/u)

  assert.throws(() => new DesignProjectRegistry({
    projectsRoot: join(root, 'nested-projects'),
    stateRoot: join(root, 'nested-projects', 'runtime'),
  }), /stateRoot must live outside projectsRoot/u)

  console.log('DESIGN PROJECT REGISTRY OK')
} finally {
  await rm(root, { recursive: true, force: true })
}
