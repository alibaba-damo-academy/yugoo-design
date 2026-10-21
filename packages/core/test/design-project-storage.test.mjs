import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

// This suite is built-plane: run the Core build before it.
const { DesignProjectManager, DesignProjectRegistry, GitVersioning } = await import('../lib/index.js')
const knowledge = { provider: 'test-embedded' }

test('project guidance is committed at creation and existing project reads preserve user files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-project-readme-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new DesignProjectManager()
  const project = await manager.create({ root: join(root, 'project'), name: 'Example', knowledge })
  const readmePath = join(project.root, 'README.md')
  const readme = await readFile(readmePath, 'utf8')
  assert.match(readme, /^# Yugoo Design 设计项目\n/u)
  assert.match(readme, /yugoo-design/u)
  const initial = await manager.status(project)
  assert.equal(initial.dirty, false, 'guidance is part of the initial checkpoint')
  const git = new GitVersioning(manager.spawn, project.root)
  assert.equal(await git.readTextAt(initial.head, 'README.md'), readme)
  const designSources = new GitVersioning(manager.spawn, project.root, 'design_files')
  assert.deepEqual(await designSources.listPathsAt(initial.head), [], 'guidance is outside versioned design sources')

  const customReadme = '# User-owned project notes\nKeep this content.\n'
  await writeFile(readmePath, customReadme)
  const edited = await manager.status(project)
  await manager.open(project.root)
  assert.equal(await readFile(readmePath, 'utf8'), customReadme)
  assert.deepEqual(await manager.status(project), edited, 'open preserves user changes and HEAD')
  await assert.rejects(manager.create({ root: project.root, name: 'Duplicate', knowledge }), { code: 'EEXIST' })
  assert.equal(await readFile(readmePath, 'utf8'), customReadme, 'creation refuses an existing project without cleanup')

  // Older projects without a README remain valid; opening does not backfill it.
  await rm(readmePath)
  const missing = await manager.status(project)
  await manager.open(project.root)
  await assert.rejects(readFile(readmePath), { code: 'ENOENT' })
  assert.deepEqual(await manager.status(project), missing)
})

test('new destination preserves registry, existing roots and exact checkpoints', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-documents-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const stateRoot = join(root, 'state')
  const old = new DesignProjectRegistry({ projectsRoot: join(root, 'legacy-projects'), stateRoot })
  const created = await old.create('Existing', knowledge)
  const before = await old.status(created.projectId)
  const registryBytes = await readFile(old.registryFile)
  const projectsRoot = join(root, 'Documents', 'YuGoo', 'Projects')
  const current = new DesignProjectRegistry({ projectsRoot, stateRoot })
  assert.equal((await current.open(created.projectId)).root, created.root)
  assert.equal((await current.status(created.projectId)).lastCheckpoint, before.lastCheckpoint)
  assert.deepEqual(await readFile(current.registryFile), registryBytes)
  await assert.rejects(readFile(projectsRoot), { code: 'ENOENT' }, 'opening does not create the new destination')
  const next = await current.create('New', knowledge)
  assert.equal(dirname(next.root), projectsRoot)
  assert.equal((await current.list()).length, 2)
  assert.equal(next.stateRoot, join(stateRoot, 'projects', next.projectId))

  // A missing destination is not replaced elsewhere, and old projects still open.
  const unavailable = join(root, 'not-a-directory')
  await writeFile(unavailable, 'sentinel')
  const broken = new DesignProjectRegistry({ projectsRoot: join(unavailable, 'Documents'), stateRoot })
  assert.equal((await broken.list()).length, 2)
  assert.equal((await broken.open(created.projectId)).root, created.root)
  await assert.rejects(broken.create('Must fail', knowledge), /ENOTDIR/)
  assert.equal(await readFile(unavailable, 'utf8'), 'sentinel')

  const lazy = new DesignProjectRegistry({ stateRoot })
  Object.defineProperty(lazy, 'projectsRoot', { get() { throw new Error('unavailable Known Folder') } })
  assert.equal((await lazy.open(created.projectId)).root, created.root)
  assert.equal((await lazy.list()).length, 2)
  await assert.rejects(lazy.create('Default unavailable', knowledge), /unavailable Known Folder/)
})

test('canonical state separation is enforced when creating and registering external projects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-storage-separation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projectsRoot = join(root, 'projects')
  const stateRoot = join(root, 'state')
  await mkdir(projectsRoot)
  await symlink(projectsRoot, stateRoot, process.platform === 'win32' ? 'junction' : 'dir')
  const alias = new DesignProjectRegistry({ projectsRoot, stateRoot })
  await assert.rejects(alias.create('Invalid', knowledge), /stateRoot must live outside/)
  const valid = new DesignProjectRegistry({ projectsRoot, stateRoot: join(root, 'valid-state') })
  const project = await valid.create('Valid', knowledge)
  const inside = new DesignProjectRegistry({ projectsRoot: join(root, 'other-projects'), stateRoot: join(project.root, 'bad-state') })
  await assert.rejects(inside.open(project.root), /stateRoot must live outside/)
  await assert.rejects(readFile(inside.registryFile), { code: 'ENOENT' }, 'invalid external project is not registered')
})
