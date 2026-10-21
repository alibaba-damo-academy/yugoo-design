import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createYugooDesignMessage } from '../src/dsh-message-source.ts'
import { DSH_ADVISORY_DELIVERY } from '../src/dsh-advisory.ts'
import { applyAdvisoryInboxEvent, DESIGN_ADVISORY_SOURCE_KIND } from '../src/design-advisory-events.ts'
import ts from 'typescript'

test('Yugoo messages retain immutable identity/content and producer-owned notice metadata', () => {
  const content = [{ type: 'text', text: 'Saved canonical facts.' }]
  const message = createYugooDesignMessage({ content, notice: 'design panel saved: example' })
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'yugoo-design', form: 'notice', summary: 'design panel saved: example' })
  assert.deepEqual(message.content, content)
  assert.ok(message.id)
  assert.ok(Object.isFrozen(message))
  assert.ok(Object.isFrozen(message.source))
  content[0].text = 'Caller changed its own input'
  assert.equal(message.content[0].text, 'Saved canonical facts.')
  const task = createYugooDesignMessage({ content: [{ type: 'text', text: 'Delegated task' }] })
  assert.deepEqual(task.source, { kind: 'yugoo-design' })
  assert.notEqual(task.id, message.id)
  const long = createYugooDesignMessage({ content: [], notice: 'x'.repeat(200) })
  assert.equal(long.source.summary, 'x'.repeat(200), 'attribution does not rewrite existing notice metadata')
})

test('advisories retain the non-waking inject operation and never claim direct human input', () => {
  const messages = []
  const agent = { inject: message => messages.push(message), followup: () => assert.fail('advice must not wake an Agent') }
  DSH_ADVISORY_DELIVERY.injectNextBoundary(agent, {
    schemaVersion: 2, id: 'finding-1', profile: 'design.alignment/v1', resultRef: 'result-1',
    inputs: [], kind: 'suggestion', attention: 'human-review', summary: 'Check saved facts',
    items: [], acceptanceInstruction: 'Review before accepting', blocksConversation: false, authorizesDesignWrite: false,
  })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].source.kind, 'yugoo-design')
  assert.equal(messages[0].source.form, 'notice')
  assert.equal(messages[0].source.summary, 'design suggestion: finding-1')
  assert.ok(messages[0].content[0].text.includes('finding-1'))
  assert.equal(messages[0].source.kind, DESIGN_ADVISORY_SOURCE_KIND)
  assert.equal(applyAdvisoryInboxEvent(4, { type: 'agent/inbox/spliced', data: { inserted: messages } }), 5)
  for (const source of [{ kind: 'user' }, { kind: 'other-producer' }, { plugin: 'dsh-design-system' }, null]) {
    assert.equal(applyAdvisoryInboxEvent(4, { type: 'agent/inbox/spliced', data: { inserted: [{ source }] } }), 4)
  }
})

test('all native producer sites use owned attribution; explicit user commands keep their own source', async () => {
  // Exhaustive source inventory prevents one rarely exercised Worker/repair path
  // from retaining the retired wrapper. Runtime admission is tested separately.
  const counts = new Map()
  for (const name of await readdir(new URL('../src/', import.meta.url))) {
    if (!name.endsWith('.ts')) continue
    const source = ts.createSourceFile(name, await readFile(new URL('../src/' + name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'kind' && ts.isStringLiteral(node.initializer)) {
        assert.notEqual(node.initializer.text, 'plugin', name + ' still emits a retired source wrapper')
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'createYugooDesignMessage') counts.set(name, (counts.get(name) ?? 0) + 1)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(Object.fromEntries([...counts].sort()), {
    'design-service.ts': 2, 'dsh-advisory.ts': 1, 'dsh-auto-panel-model.ts': 1,
    'dsh-content-upgrade.ts': 1, 'dsh-file-worker-agent.ts': 1, 'dsh-producer-agent.ts': 2, 'panel-remote.ts': 1,
  })
  const service = await readFile(new URL('../src/design-service.ts', import.meta.url), 'utf8')
  assert.match(service, /invocation\.agent\.steer\(createUserMessage\(\{[\s\S]*?source: \{ kind: 'user' \}/)
})
