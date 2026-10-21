/** A native run belongs to one Design Project, even when CLI cwd stays unchanged. */
import { mkdir, writeFile, readFile, link, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireNativeId, nativeScope } from './native-identity.mjs'

export async function bindNativeProject({ stateRoot, runId, projectId, host = 'codex', sessionId }) {
  requireNativeId(host, runId)
  const root = host === 'codex' ? join(stateRoot, 'native-run-projects')
    : join(stateRoot, 'native-run-projects', nativeScope(host, sessionId))
  await mkdir(root, { recursive: true, mode: 0o700 })
  const target = join(root, `${host === 'codex' ? runId.toLowerCase() : runId}.json`)
  const temporary = join(root, `${randomUUID()}.tmp`)
  const bytes = JSON.stringify({ projectId })
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
  try {
    // Publish complete bytes without overwriting another process's binding.
    try { await link(temporary, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const owner = JSON.parse(await readFile(target, 'utf8'))
    if (owner.projectId !== projectId) throw new Error('Native run is already bound to another Design Project. Start a new native child for this project.')
  } finally { await unlink(temporary) }
}
