/** Focused smoke for repeatable draft validation and authoritative publication validation. */
import assert from 'node:assert/strict'
import {
  publishDesignWorkingCopy,
  validateDesignWorkingCopy,
} from '../packages/core/src/design-validation-phases.ts'

{
  const calls = []
  const phases = {
    integration: {
      async validate(draft, context) {
        calls.push(`integration:${context.revision}`)
        return draft.connected === true ? [] : ['connect the draft']
      },
    },
    completion: {
      async prepare(draft, context) {
        calls.push(`prepare:${context.revision}`)
        return { canonical: true, draft }
      },
      async validate(prepared, context) {
        calls.push(`completion:${context.revision}`)
        assert.equal(prepared.canonical, true)
        return []
      },
      async finalize(prepared, context) {
        calls.push(`finalize:${context.revision}`)
        return { revision: context.revision, prepared }
      },
    },
  }

  const first = await validateDesignWorkingCopy(phases, { connected: false }, { revision: 'working-copy-1' })
  const second = await validateDesignWorkingCopy(phases, { connected: false }, { revision: 'working-copy-1' })
  assert.deepEqual(first, { kind: 'rejected', phase: 'integration', diagnostics: ['connect the draft'] })
  assert.deepEqual(second, first, 'draft validation is repeatable and has no finalizer effect')
  assert.deepEqual(calls, ['integration:working-copy-1', 'integration:working-copy-1'])

  const published = await publishDesignWorkingCopy(phases, { connected: true }, { revision: 'authoritative-2' })
  assert.deepEqual(published, {
    kind: 'published',
    receipt: {
      revision: 'authoritative-2',
      prepared: { canonical: true, draft: { connected: true } },
    },
  })
  assert.deepEqual(calls.slice(2), [
    'integration:authoritative-2',
    'prepare:authoritative-2',
    'completion:authoritative-2',
    'finalize:authoritative-2',
  ], 'publish re-runs integration, then validates the prepared canonical write before finalization')
}

for (const rejectedPhase of ['integration', 'completion']) {
  let finalized = false
  const phases = {
    integration: {
      validate: async () => rejectedPhase === 'integration' ? ['integration rejected'] : [],
    },
    completion: {
      prepare: async (draft) => ({ prepared: true, draft }),
      validate: async () => rejectedPhase === 'completion' ? ['completion rejected'] : [],
      finalize: async () => { finalized = true; return 'must not publish' },
    },
  }
  const result = await publishDesignWorkingCopy(phases, {}, {})
  assert.deepEqual(result, {
    kind: 'rejected',
    phase: rejectedPhase,
    diagnostics: [`${rejectedPhase} rejected`],
  })
  assert.equal(finalized, false)
}

console.log('DESIGN VALIDATION PHASES OK')
