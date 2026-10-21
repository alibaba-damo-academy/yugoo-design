import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DesignBundleContributionRegistry,
  DesignDriverId,
  deriveDesignBundleAuthorityId,
} from './lib/index.js'

const driverId = DesignDriverId('example.bundle/v1')
const authority = deriveDesignBundleAuthorityId('package:example-kit', 'example_bundle')
const copiedAuthority = deriveDesignBundleAuthorityId('package:copied-kit', 'example_bundle')
const driver = Object.freeze({ renderState: () => [] })

function nativeKit(bundleAuthority) {
  return Object.freeze({
    name: 'example-kit',
    revision: '1'.repeat(64),
    mindset: '',
    resources: Object.freeze({}),
    skills: Object.freeze([Object.freeze({
      name: 'example_bundle',
      authority: bundleAuthority,
      revision: '2'.repeat(64),
      description: '',
      title: Object.freeze({ zh: '示例技能', en: 'Example skill' }),
      label: Object.freeze({ zh: '示例', en: 'Example' }),
      content: '',
      execution: Object.freeze({ handoff: 'none' }),
      metadata: Object.freeze({
        skillManifest: Object.freeze({
          runtime: Object.freeze({ driver: driverId }),
          presentation: Object.freeze({ mode: 'native', renderer: driverId }),
        }),
      }),
    })]),
  })
}

test('one Bundle may use the same authority-bound id for runtime and native presentation', () => {
  let referenced = false
  const registry = new DesignBundleContributionRegistry(() => referenced ? 'contribution is referenced' : undefined)
  const dispose = registry.registerBundleContribution({
    authority,
    runtime: Object.freeze({ id: driverId, driver }),
    presentation: driverId,
  })

  registry.assertKit(nativeKit(authority))
  assert.throws(() => registry.assertKit(nativeKit(copiedAuthority)), /not authorized for Bundle authority/u)

  referenced = true
  assert.throws(dispose, /contribution is referenced/u)
  referenced = false
  dispose()
  assert.throws(() => registry.assertKit(nativeKit(authority)), /runtime driver .* is not installed/u)
})
