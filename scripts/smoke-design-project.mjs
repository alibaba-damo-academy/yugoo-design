/** Smoke the host-neutral Design Project core against real Git and filesystem. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DESIGN_PROJECT_FORMAT_VERSION,
  DesignProjectManager,
  parseDesignProjectMetadata,
} from '../packages/core/src/design-project.ts'

const parent = await mkdtemp(join(tmpdir(), 'dsh-design-project-smoke-'))
const projectRoot = join(parent, 'todo')
const version = '1.0'
const id = '0198e58d-2fd4-7a45-b667-620f71dba9df'
const knowledge = { provider: 'test-embedded' }
const manager = new DesignProjectManager({
  createId: () => id,
  now: () => new Date('2026-08-24T00:00:00.000Z'),
})

try {
  const project = await manager.create({
    root: projectRoot,
    name: 'todo',
    knowledge,
    kit: { name: 'web_app', version },
  })
  assert.equal(project.metadata.formatVersion, DESIGN_PROJECT_FORMAT_VERSION)
  assert.equal(project.metadata.id, id)
  assert.deepEqual(project.metadata.knowledge, knowledge)
  assert.equal(project.metadata.kit?.version, version)
  assert.equal(project.designFilesRoot, join(projectRoot, 'design_files'))
  assert.equal((await stat(join(projectRoot, '.git'))).isDirectory(), true)
  assert.equal((await stat(project.designFilesRoot)).isDirectory(), true)
  assert.match(await readFile(join(projectRoot, '.gitignore'), 'utf8'), /\.DS_Store/u)

  const baseline = await manager.status(project)
  assert.equal(baseline.dirty, false)
  assert.match(baseline.head, /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u)

  const reopened = await manager.open(projectRoot)
  assert.deepEqual(reopened.metadata, project.metadata)

  const bundleRoot = manager.bundleRoot(project, 'page_design')
  await mkdir(bundleRoot)
  await writeFile(join(bundleRoot, 'preview.html'), '<main>Todo</main>\n', 'utf8')
  const dirty = await manager.status(project)
  assert.equal(dirty.dirty, true)
  assert.match(dirty.porcelain, /design_files\/page_design\/preview\.html/u)
  assert.throws(() => manager.bundleRoot(project, '../escape'), /unsafe Bundle directory/u)

  assert.throws(() => parseDesignProjectMetadata({
    ...project.metadata,
    runtimeSelection: { kit: 'web_app' },
  }), /extra: runtimeSelection/u)
  assert.throws(() => parseDesignProjectMetadata({
    ...project.metadata,
    formatVersion: 1,
  }), /unsupported Design Project format/u)
  const { knowledge: _missingKnowledge, ...missingKnowledge } = project.metadata
  assert.throws(() => parseDesignProjectMetadata(missingKnowledge), /missing: knowledge/u)
  assert.throws(() => parseDesignProjectMetadata({
    ...project.metadata,
    knowledge: { provider: 'Ladybug WASM' },
  }), /invalid Design Knowledge provider id/u)

  const metadataPath = join(projectRoot, 'project.json')
  const validMetadata = await readFile(metadataPath, 'utf8')
  await writeFile(metadataPath, '{"kind":"wrong"}\n', 'utf8')
  await assert.rejects(manager.open(projectRoot), /invalid fields|expected "dsh-design-project"/u)
  await writeFile(metadataPath, validMetadata, 'utf8')

  const occupied = join(parent, 'occupied')
  await mkdir(occupied)
  await writeFile(join(occupied, 'keep.txt'), 'keep\n', 'utf8')
  await assert.rejects(manager.create({ root: occupied, name: 'occupied', knowledge }), /EEXIST/u)
  assert.equal(await readFile(join(occupied, 'keep.txt'), 'utf8'), 'keep\n')

  const invalidGit = join(parent, 'invalid-git')
  await mkdir(join(invalidGit, '.git'), { recursive: true })
  await mkdir(join(invalidGit, 'design_files'))
  await writeFile(join(invalidGit, '.gitignore'), '# test\n', 'utf8')
  await writeFile(join(invalidGit, 'project.json'), validMetadata, 'utf8')
  await assert.rejects(manager.open(invalidGit), /design project git/u)

  console.log('design project smoke: OK')
} finally {
  await rm(parent, { recursive: true, force: true })
}
