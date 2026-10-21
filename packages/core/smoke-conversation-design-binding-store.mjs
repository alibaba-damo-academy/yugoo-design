import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION,
  ConversationDesignBindingRevisionMismatchError,
  ConversationDesignBindingStore,
  DesignProjectId,
  conversationDesignBindingKey,
} from './lib/index.js'

const alpha = DesignProjectId('11111111-1111-4111-8111-111111111111')
const beta = DesignProjectId('22222222-2222-4222-8222-222222222222')
const key = conversationDesignBindingKey({
  hostKind: 'dsh-web',
  hostInstanceId: 'fixture-installation',
  conversationId: 'conversation/opaque:value',
})

test('bind, rebind, and unbind preserve a strict durable CAS history', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'conversation-design-binding-'))
  const root = join(fixture, 'plugin-state')
  try {
    const store = new ConversationDesignBindingStore({ root })
    assert.deepEqual(await store.read(key), {
      schemaVersion: CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION,
      key,
      revision: 0,
      projectId: null,
    })

    const created = await store.bind(key, alpha, 0)
    assert.equal(created.revision, 1)
    assert.equal(created.projectId, alpha)

    const restarted = new ConversationDesignBindingStore({ root })
    assert.deepEqual(await restarted.read(key), created)

    const opened = await restarted.bind(key, beta, created.revision)
    assert.equal(opened.revision, 2)
    assert.equal(opened.projectId, beta)
    await assert.rejects(
      restarted.unbind(key, created.revision),
      error => error instanceof ConversationDesignBindingRevisionMismatchError
        && error.expected === 1
        && error.actual === 2,
    )

    const competitors = await Promise.allSettled([
      restarted.bind(key, alpha, opened.revision),
      restarted.bind(key, beta, opened.revision),
    ])
    assert.equal(competitors.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = competitors.find(result => result.status === 'rejected')
    assert.ok(rejected?.reason instanceof ConversationDesignBindingRevisionMismatchError)
    assert.equal(rejected.reason.actual, 3)

    const rebound = await restarted.read(key)
    const closed = await restarted.unbind(key, rebound.revision)
    assert.equal(closed.revision, 4)
    assert.equal(closed.projectId, null)
    assert.deepEqual(await new ConversationDesignBindingStore({ root }).read(key), closed)

    const files = await readdir(root)
    assert.equal(files.filter(name => name.endsWith('.json')).length, 1)
    assert.deepEqual(files.filter(name => name.endsWith('.tmp')), [])
    const persisted = JSON.parse(await readFile(join(root, files.find(name => name.endsWith('.json'))), 'utf8'))
    assert.deepEqual(Object.keys(persisted), ['schemaVersion', 'key', 'revision', 'projectId'])
    assert.deepEqual(Object.keys(persisted.key), ['hostKind', 'hostInstanceId', 'conversationId'])
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('persistent parsing and public identities fail loud at their input boundaries', async () => {
  assert.throws(() => new ConversationDesignBindingStore({ root: 'relative' }), /root must be an absolute path/u)
  assert.throws(() => conversationDesignBindingKey({
    hostKind: '',
    hostInstanceId: 'instance',
    conversationId: 'conversation',
  }), /hostKind/u)
  assert.throws(() => conversationDesignBindingKey({
    hostKind: 'host',
    hostInstanceId: 'instance',
    conversationId: 'bad\nconversation',
  }), /conversationId/u)

  const fixture = await mkdtemp(join(tmpdir(), 'conversation-design-binding-corrupt-'))
  const root = join(fixture, 'plugin-state')
  try {
    const store = new ConversationDesignBindingStore({ root })
    await assert.rejects(store.bind(key, alpha, -1), /expectedRevision/u)
    await store.bind(key, alpha, 0)
    const [file] = (await readdir(root)).filter(name => name.endsWith('.json'))
    const path = join(root, file)
    const document = JSON.parse(await readFile(path, 'utf8'))

    await writeFile(path, `${JSON.stringify({ ...document, extra: true })}\n`, 'utf8')
    await assert.rejects(store.read(key), /invalid fields/u)

    await writeFile(path, '{not json}\n', 'utf8')
    await assert.rejects(store.read(key), /invalid JSON/u)

    await writeFile(path, `${JSON.stringify({
      ...document,
      key: { ...document.key, conversationId: 'another-conversation' },
    })}\n`, 'utf8')
    await assert.rejects(store.read(key), /does not match its storage identity/u)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
