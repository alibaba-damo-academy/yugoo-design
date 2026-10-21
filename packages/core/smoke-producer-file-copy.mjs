/** Exact-byte asset reuse, source confinement and unchanged destination authority. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api')
register()
const { copyProducerFile } = await import('./src/dsh-producer-design-tools.ts')
const { resolveConfinedFilePath } = await import('./src/confined-fs.ts')

const root = await mkdtemp(join(tmpdir(), 'producer-copy-'))
const source = join(root, 'source')
const project = join(root, 'design_files')
await mkdir(source)
await mkdir(join(project, 'design_style'), { recursive: true })
const original = Buffer.from([0, 255, 137, 80, 78, 71, 13, 10])
await writeFile(join(source, 'logo.png'), original)
await writeFile(join(root, 'outside.png'), 'outside')
await symlink(join(root, 'outside.png'), join(source, 'escape.png'))
await symlink(join(root, 'outside.png'), join(project, 'design_style', 'escape.png'))
const workspace = {
  async read(path) {
    const resolved = await resolveConfinedFilePath(project, path)
    try { return { encoding: 'base64', content: (await readFile(resolved)).toString('base64') } }
    catch (e) { if (e.code === 'ENOENT') return undefined; throw e }
  },
  async write(path, file) {
    if (!path.startsWith('design_style/')) throw new Error('outside Bundle')
    await writeFile(await resolveConfinedFilePath(project, path), Buffer.from(file.content, file.encoding))
  },
}
const signal = new AbortController().signal
const copy = (from, to = 'design_style/logo.png', input = source, s = signal) => copyProducerFile(workspace, from, to, s, input)
const receipt = await copy(join(source, 'logo.png'))
assert.deepEqual(receipt, { path: 'design_style/logo.png', bytes: original.length })
assert.deepEqual(await readFile(join(project, receipt.path)), original)
assert.deepEqual(await readFile(join(source, 'logo.png')), original, 'copy leaves source unchanged')
assert.deepEqual(await copy(join(source, 'logo.png')), receipt, 'identical destination is safely reusable')
await copy('design_style/logo.png', 'design_style/duplicate.png')
assert.deepEqual(await readFile(join(project, 'design_style/duplicate.png')), original)
await assert.rejects(copy(join(root, 'outside.png')), /authorized reconstruction/)
await assert.rejects(copy(join(source, 'escape.png')), /authorized reconstruction/)
await assert.rejects(copy(source), /regular file/)
await assert.rejects(copy(join(source, 'logo.png'), '../outside.png'), /path/)
await assert.rejects(copy(join(source, 'logo.png'), 'design_style/escape.png'), /symbolic link/)
await assert.rejects(copy(join(source, 'logo.png'), 'other/logo.png'), /outside Bundle/)
await assert.rejects(copyProducerFile(workspace, join(source, 'logo.png'), 'design_style/logo.png', signal), /requires an authorized/)
await copy(join(source, 'logo.png'), 'design_style/single.png', join(source, 'logo.png'))
await writeFile(join(source, 'neighbor.png'), 'different')
await assert.rejects(copy(join(source, 'neighbor.png'), 'design_style/single.png', join(source, 'logo.png')), /exact input file/)
await assert.rejects(copy(join(source, 'neighbor.png')), /different bytes/)
assert.deepEqual(await readFile(join(project, 'design_style/logo.png')), original)
const cancelled = new AbortController(); cancelled.abort()
await assert.rejects(copy(join(source, 'logo.png'), 'design_style/cancelled.png', source, cancelled.signal), /abort/i)
assert.equal(await workspace.read('design_style/cancelled.png'), undefined)
const cancelledDuringWrite = new AbortController()
await assert.rejects(copyProducerFile({
  ...workspace,
  async write(path, file, signal) {
    await workspace.write(path, file, signal)
    cancelledDuringWrite.abort()
  },
}, join(source, 'logo.png'), 'design_style/interrupted.png', cancelledDuringWrite.signal, source), /abort/i)
assert.deepEqual(await readFile(join(project, 'design_style/interrupted.png')), original,
  'cancellation after write must not report success, but preserves written work')
const large = await open(join(source, 'large.png'), 'w')
await large.truncate(10 * 1024 * 1024 + 1); await large.close()
await assert.rejects(copy(join(source, 'large.png')), /at most 10 MiB/)
console.log('PRODUCER FILE COPY OK')
