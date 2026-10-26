/** Tiny inventory-only assets for assembler tests; never runtime/ABI evidence. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stageCompanionNativeGit } from '../companion-native-git.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export async function stageNativeInventoryFixture(shared) {
  const files = new Map([['index.cjs', Buffer.from('// inventory fixture; no executable binding')],
    ['LICENSE', Buffer.from('fixture license')], ['NOTICE', Buffer.from('fixture notice')]])
  const artifacts = []
  for (const target of ['linux-x64', 'win32-x64', 'darwin-arm64']) {
    const path = `native/yugoo_git.${target}.node`, bytes = Buffer.from('not executable: ' + target)
    files.set(path, bytes); artifacts.push({ path, bytes: bytes.length, sha256: sha(bytes) })
  }
  const source = Buffer.from(JSON.stringify({ inputs: [{ path: 'index.cjs', sha256: sha(files.get('index.cjs')) }], artifacts }))
  files.set('SOURCE.json', source)
  await mkdir(join(shared, 'scripts'), { recursive: true })
  await writeFile(join(shared, 'scripts/git-native-worker.js'), '// inventory fixture; not a worker\n')
  await writeFile(join(shared, 'scripts/git-runtime-check.mjs'), '// inventory fixture; not runtime execution\n')
  return stageCompanionNativeGit(shared, { files, sourceSha256: sha(source), version: '0.0.0-fixture' })
}
