import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { apply } from '../src/dsh-design-execution-plugin.ts'

const limits = {
  maxArtifactInputFiles: 10, maxArtifactInputPathBytes: 1024,
  maxArtifactInputFileBytes: 1024, maxArtifactInputTotalBytes: 10240,
}

function rootFixture() {
  const tools = new Map()
  const providers = new Map()
  const injections = []
  let unregisters = 0
  const ctx = {
    design: {}, tools: { register: tool => tools.set(tool.name, tool) },
    on: () => () => {}, systemPrompt: { section: () => () => {} },
    inject: (names, callback) => { injections.push({ names, callback }) },
  }
  const service = {
    subagents: {
      registerProvider: provider => {
        if (providers.has(provider.name)) throw new Error('duplicate provider')
        providers.set(provider.name, provider)
        return () => { unregisters++; providers.delete(provider.name) }
      },
      start: () => { throw new Error('No model execution in root wiring fixture') },
    },
  }
  return { ctx, service, providers, tools, injections, unregisters: () => unregisters }
}

test('shipped DSH patch explicitly activates the bounded file Worker dispatcher', () => {
  const patch = parse(readFileSync(new URL('../../dsh/cordis.patch.yml', import.meta.url), 'utf8'))
  const execution = patch.flatMap(entry => entry.insert ?? []).find(entry => entry.id === 'dsh-design-execution')
  assert.equal(execution.config.delegation.provider, 'dsh-design-file-worker')
  const f = rootFixture()
  apply(f.ctx, execution.config)
  const dispose = f.injections[0].callback(f.service)
  assert.equal(f.providers.has('dsh-design-file-worker'), true)
  dispose()
  assert.equal(f.unregisters(), 1)
})

test('actual root plugin registers owned provider only on explicit opt-in and disposes it once', () => {
  for (const provider of [undefined, 'spawn', 'custom-provider', 'dsh-design-file-worker']) {
    const f = rootFixture()
    apply(f.ctx, { ...limits, ...(provider ? { delegation: { provider, maxDepth: 3 } } : {}) })
    assert.ok(f.tools.has('run_design_skill'))
    assert.deepEqual(f.injections.map(x => x.names), [['subagents']])
    assert.equal(f.providers.size, 0, 'Optional service has not mounted yet')
    const dispose = f.injections[0].callback(f.service)
    assert.equal(f.providers.has('dsh-design-file-worker'), provider === 'dsh-design-file-worker')
    dispose()
    dispose()
    assert.equal(f.providers.size, 0)
    assert.equal(f.unregisters(), provider === 'dsh-design-file-worker' ? 1 : 0)
  }
})
