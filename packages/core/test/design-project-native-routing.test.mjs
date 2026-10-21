import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DesignProjectManager } from '../src/design-project.ts'

async function fixture(t, native) {
  const root = await mkdtemp(join(tmpdir(), 'native-project-routing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.git')); await mkdir(join(root, 'design_files'))
  await writeFile(join(root, '.gitignore'), '')
  await writeFile(join(root, 'project.json'), JSON.stringify({ kind: 'dsh-design-project', formatVersion: 3,
    id: '0198e58d-2fd4-7a45-b667-620f71dba9df', name: 'Fixture', createdAt: '2026-08-24T00:00:00.000Z',
    knowledge: { provider: 'test-embedded' } }))
  const calls = []
  const spawn = Object.assign(() => { throw Error('external Git must not run') }, { native: async request => {
    calls.push(request.operation.kind)
    return native(request, root)
  } })
  return { root, calls, manager: new DesignProjectManager({ spawn, gitBackend: 'native' }) }
}
const inspection = root => ({ value: { format: 'sha1', head: 'a'.repeat(40),
  workdir: root, gitDir: join(root, '.git'), indexPath: join(root, '.git', 'index') } })

test('manager open/status use the existing native port, preserve porcelain and avoid duplicate probes', async t => {
  const f = await fixture(t, (request, root) => request.operation.kind === 'inspect'
    ? inspection(root) : { value: { porcelain: '?? design_files/draft.json\n' } })
  const opened = await f.manager.open(f.root)
  assert.deepEqual(f.calls, ['inspect'])
  assert.deepEqual(await f.manager.status(opened), { head: 'a'.repeat(40), dirty: true, porcelain: '?? design_files/draft.json\n' })
  assert.deepEqual(f.calls, ['inspect', 'inspect', 'status'])
})

test('manager never retries a rejected scoped native port via the default executor', async t => {
  const f = await fixture(t, () => { throw Error('scope revoked fixture') })
  await assert.rejects(f.manager.open(f.root), /scope revoked fixture/)
  assert.deepEqual(f.calls, ['inspect'])
})

test('fresh inspection must match the actual root, Git directory and committed HEAD', async t => {
  let change
  const f = await fixture(t, (_request, root) => ({ value: { ...inspection(root).value, ...change } }))
  change = { workdir: tmpdir() }
  await assert.rejects(f.manager.open(f.root), /does not match project root/)
  change = { gitDir: tmpdir() }
  await assert.rejects(f.manager.open(f.root), /metadata directory does not match/)
  change = { head: undefined }
  await assert.rejects(f.manager.open(f.root), /invalid HEAD/)
  change = { head: 'a'.repeat(64), format: 'sha1' }
  await assert.rejects(f.manager.open(f.root), /invalid HEAD/)
  change = { head: 'a'.repeat(40), format: 'sha256' }
  await assert.rejects(f.manager.open(f.root), /invalid HEAD/)
})
