import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { satisfies } from 'semver'

export const host = name => /^@deepseek-ai\/(?:cordis|schemastery|dsh-)/u.test(name)

// Official packages need not export their package.json. Resolve metadata without
// executing a host or requiring a private checkout.
export function installedPackage(name, requireFrom) {
  const entry = realpathSync(requireFrom.resolve(name))
  let directory = dirname(entry)
  for (;;) {
    const path = join(directory, 'package.json')
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      if (value.name === name) return { entry, manifest: value }
    }
    const parent = dirname(directory)
    assert.notEqual(parent, directory, `Package identity not found for ${name}`)
    directory = parent
  }
}

export function assertPeer(name, version, range) {
  assert.equal(typeof range, 'string', `${name}: declared peer required`)
  assert.equal(satisfies(version, range), true, `${name}@${version} does not satisfy ${range}`)
}

export function installedPeer(name, requireFrom, optional = false) {
  try {
    requireFrom.resolve(name)
  } catch (error) {
    if (optional && error.code === 'MODULE_NOT_FOUND') return undefined
    throw error
  }
  return installedPackage(name, requireFrom)
}

export function assertCordisIdentity(expected, consumer, actual) {
  assert.equal(actual, expected, `${consumer}: different Cordis identity splits Context service/event augmentation`)
}
