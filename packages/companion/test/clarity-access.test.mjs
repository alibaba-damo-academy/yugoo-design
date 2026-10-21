import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesignProjectRegistry } from '../../core/lib/index.js'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { staticFixture } from './static-fixture.mjs'

const threadId = '11111111-1111-4111-8111-111111111111'
const kitRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))

test('readWorkspace never certifies fresh clarity without an active, available exact Kit', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-clarity-access-'))
  let server, runtimeLoads = 0, notifications = 0
  try {
    const registry = new DesignProjectRegistry({ projectsRoot: join(root, 'projects'), stateRoot: join(root, 'registry') })
    t.diagnostic('Creating isolated project fixture; no knowledge runtime is acquired')
    const project = await registry.create('Access-only clarity regression', { provider: 'ladybug-wasm' })
    const directory = join(project.root, 'design_files', 'preserved')
    await mkdir(directory, { recursive: true })
    const textPath = join(directory, 'notes.md'), binaryPath = join(directory, 'attachment.bin')
    const text = Buffer.from('User-owned evidence must not be rewritten by a status read.\n'), binary = Buffer.from([0, 255, 1, 128, 10])
    await Promise.all([writeFile(textPath, text), writeFile(binaryPath, binary)])
    t.diagnostic('Opening source Companion with injected disabled knowledge runtime')
    server = await startCompanion({ ...await staticFixture(root), host: 'codex', threadId,
      projectRoot: project.root, kitRoot, stateRoot: join(root, 'companion'),
      embedding: { provider: 'disabled' },
      knowledgeRuntime: async () => { runtimeLoads++; throw Error('Knowledge runtime disabled in access-only regression') },
      connection: { host: 'codex', threadId, async send() { notifications++; throw Error('Native delivery is outside access-only regression') } },
    })
    const read = () => callCompanion(server.connectionPath, { method: 'readWorkspace', params: {} })
    const check = async (mode, pin) => {
      t.diagnostic(`Reading workspace access snapshot: ${mode}${pin ? ` ${pin.name}@${pin.version}` : ''}`)
      const metadata = await readFile(join(project.root, 'project.json'))
      const status = await read()
      assert.equal(status.access.mode, mode)
      assert.equal(status.access.writable, false)
      if (pin) assert.deepEqual(status.access.kit, pin)
      assert.equal(status.clarity.assessment, null)
      assert.equal(status.clarity.needsReassessment, true)
      assert.deepEqual(await readFile(textPath), text)
      assert.deepEqual(await readFile(binaryPath), binary)
      assert.deepEqual(await readFile(join(project.root, 'project.json')), metadata, 'status does not choose or rewrite a Kit pin')
      t.diagnostic(`Verified snapshot: ${mode}`)
    }
    await check('unconfigured')
    const unknown = { name: 'unavailable_test_kit', version: '1.0' }
    await registry.setKitPin(project.projectId, unknown)
    await check('recovery', unknown)
    const mismatch = { name: 'web_app', version: '999.0' }
    await registry.setKitPin(project.projectId, mismatch)
    await check('recovery', mismatch)
    assert.equal(runtimeLoads, 0, 'access checks reject before any database/model runtime acquisition')
    assert.equal(notifications, 0, 'status reads never wake a native conversation')
  } finally {
    await server?.close()
    await rm(root, { recursive: true, force: true })
  }
})
