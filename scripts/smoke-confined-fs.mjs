/** Focused Design Files symbolic-link confinement smoke. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DesignFilesStore,
  readConfinedText,
  writeConfinedText,
} from '../packages/core/lib/index.js'

const nodeFs = {
  readText: async (path) => {
    try { return await readFile(path, 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
  },
  writeText: async (path, content) => { await writeFile(path, content, 'utf8') },
  ensureDir: async (path) => { await mkdir(path, { recursive: true }) },
}

const unreachableGit = {
  invalidatePolledHead: () => {},
  assertCleanIndex: async () => {},
  assertCleanWorktree: async () => {},
  head: async () => undefined,
  commit: async () => { throw new Error('git commit must not run for a confined-path rejection') },
  diffCommit: async () => '',
  diffSince: async () => '',
  rollback: async () => {},
}

const temp = await mkdtemp(join(tmpdir(), 'dsh-design-confined-'))
try {
  const root = join(temp, 'design_files')
  const outside = join(temp, 'outside')
  await mkdir(root)
  await mkdir(outside)

  await writeConfinedText(nodeFs, root, 'normal/nested.txt', 'inside\n')
  assert.equal(await readConfinedText(nodeFs, root, 'normal/nested.txt'), 'inside\n')
  assert.equal(await readConfinedText(nodeFs, root, 'normal/missing.txt'), undefined)

  await symlink(outside, join(root, 'escaped'))
  await assert.rejects(
    writeConfinedText(nodeFs, root, 'escaped/new.txt', 'outside\n'),
    /symbolic link/,
  )
  await assert.rejects(readFile(join(outside, 'new.txt'), 'utf8'), { code: 'ENOENT' })

  await writeFile(join(outside, 'secret.txt'), 'secret\n', 'utf8')
  await assert.rejects(readConfinedText(nodeFs, root, 'escaped/secret.txt'), /symbolic link/)

  await symlink(join(outside, 'secret.txt'), join(root, 'normal', 'secret-link.txt'))
  await assert.rejects(readConfinedText(nodeFs, root, 'normal/secret-link.txt'), /symbolic link/)
  await assert.rejects(
    writeConfinedText(nodeFs, root, 'normal/secret-link.txt', 'overwrite\n'),
    /symbolic link/,
  )
  assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'secret\n')

  const store = new DesignFilesStore(nodeFs, unreachableGit, root)
  await assert.rejects(store.write('escaped', { safe: false }, {
    origin: 'agent',
    settleEvent: async () => { throw new Error('settlement must not run') },
  }), /symbolic link/)
  await assert.rejects(readFile(join(outside, 'escaped.json'), 'utf8'), { code: 'ENOENT' })

  await assert.rejects(readConfinedText(nodeFs, root, '../outside/secret.txt'), /stay inside design_files/)
  await assert.rejects(readConfinedText(nodeFs, root, '/outside/secret.txt'), /stay inside design_files/)

  console.log('DESIGN FILES CONFINEMENT OK')
} finally {
  await rm(temp, { recursive: true, force: true })
}
