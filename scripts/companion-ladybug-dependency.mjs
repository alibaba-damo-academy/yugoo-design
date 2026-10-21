/** Candidate-only dependency selection. No registry lookup, install or fallback. */
import assert from 'node:assert/strict'
import { valid } from 'semver'

export const OFFICIAL_LADYBUG_VERSION = '0.21.1'

export function validateLadybugDependency(specifier) {
  if (specifier === OFFICIAL_LADYBUG_VERSION) return specifier
  const alias = typeof specifier === 'string'
    ? /^npm:(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)@(.+)$/u.exec(specifier)
    : null
  assert.ok(alias && valid(alias[2]) === alias[2], 'Explicit Ladybug dependency required: official 0.21.1 or scoped npm alias with exact version')
  return specifier
}

export function selectCandidateLadybug({ ladybugDependency, ladybugVersion, scope }) {
  if (ladybugDependency !== undefined) {
    assert.equal(ladybugVersion, undefined, 'Conflicting Ladybug selectors')
    return validateLadybugDependency(ladybugDependency)
  }
  assert.match(scope ?? '', /^@[a-z0-9][a-z0-9._-]*$/u)
  assert.ok(typeof ladybugVersion === 'string' && valid(ladybugVersion) === ladybugVersion, 'Explicit Ladybug dependency or legacy exact ladybugVersion required')
  return validateLadybugDependency(`npm:${scope}/ladybug-wasm-core@${ladybugVersion}`)
}

export function parseLadybugBuildArgs(args) {
  assert.ok(args.length === 2 && args[0] === '--ladybug-dependency', 'Use --ladybug-dependency with an explicit exact specifier')
  return { ladybugDependency: validateLadybugDependency(args[1]) }
}
