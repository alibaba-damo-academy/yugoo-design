/** Keyless acceptance for projecting one authoritative Runtime continuation gate. */
import assert from 'node:assert/strict'
import { deriveDesignContinuation } from '../packages/core/lib/index.js'

function gate(invocationId = 'page-run-1') {
  return {
    kind: 'user_continue',
    invocationId,
    pin: {
      invocationId,
      projectId: '11111111-1111-4111-8111-111111111111',
      kitName: 'web_app',
      kitVersion: '1.0',
      skillName: 'page_design',
      bundleVersion: '1.0',
      stateRevision: 'commit-pending',
    },
    action: {
      routeId: 'execute_plan',
      label: { zh: '继续生成页面', en: 'Generate Pages' },
      aliases: {
        zh: ['生成全部页面', '继续生成页面'],
        en: ['Generate all pages', 'Continue generating pages'],
      },
    },
  }
}

const pending = deriveDesignContinuation({
  gate: gate(),
  title: { zh: '页面设计', en: 'Page Design' },
  journalRevision: 12,
  summary: '5 pages pending',
})
assert.deepEqual(pending, {
  skill: 'page_design',
  title: { zh: '页面设计', en: 'Page Design' },
  invocationId: 'page-run-1',
  routeId: 'execute_plan',
  label: { zh: '继续生成页面', en: 'Generate Pages' },
  aliases: {
    zh: ['生成全部页面', '继续生成页面'],
    en: ['Generate all pages', 'Continue generating pages'],
  },
  journalRevision: 12,
  summary: '5 pages pending',
})
assert.ok(Object.isFrozen(pending) && Object.isFrozen(pending.label) && Object.isFrozen(pending.aliases.zh))
assert.deepEqual(JSON.parse(JSON.stringify(pending)), pending, 'descriptor must be JSON-only')

const minimal = deriveDesignContinuation({
  gate: { ...gate('page-run-2'), action: { ...gate('page-run-2').action, aliases: undefined } },
  summary: '   ',
})
assert.equal(minimal.invocationId, 'page-run-2')
assert.equal('aliases' in minimal, false)
assert.equal('title' in minimal, false)
assert.equal('journalRevision' in minimal, false)
assert.equal('summary' in minimal, false)

console.log('DESIGN CONTINUATION DERIVATION OK')
