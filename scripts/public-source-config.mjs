/** Pure public-source configuration proposal. No filesystem, install or publication. */
import assert from 'node:assert/strict'
import { posix } from 'node:path'
import { valid, validRange, satisfies } from 'semver'

const FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
const local = value => /^(?:file:|link:|workspace:|portal:|\.\.?\/|\/)/u.test(value)
const host = name => /^@deepseek-ai\/(?:dsh-[a-z0-9-]+|cordis|schemastery)$/u.test(name)
const digestable = value => JSON.stringify(value)
function overrideSelector(selector) {
  const match = /^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:@([~^])(.+))?$/u.exec(selector)
  assert.ok(match, 'Only package names or single bounded version selectors are supported')
  if (match[2]) assert.equal(valid(match[3]), match[3], 'Override selector must use a canonical version')
  return { name: match[1], range: match[2] ? match[2] + match[3] : null }
}
function packagePath(path) {
  assert.match(path, /^packages\/[a-z0-9-]+\/package\.json$/u, 'Explicit own-package manifest path required')
}

/**
 * Select a reproducible source build baseline, not a new package naming scheme.
 * Names/imports/descriptors remain intact. Exact prerelease peer additions are
 * proposed, never a claim that their runtime contracts have been verified.
 */
export function proposePublicSourceConfig({ root, workspace, packages, officialVersions,
  ladybugVersion, rootScripts, rootScriptFileExclusions = {}, reviewedWorkspaceOverrides = {} }) {
  assert.ok(root && workspace && packages && officialVersions, 'Configuration inputs required')
  assert.equal(root.private, true, 'Source workspace must remain private')
  assert.deepEqual(workspace.packages, ['packages/*'], 'Only the own-package source workspace is supported')
  assert.ok(Object.keys(workspace).every(key => ['packages', 'allowBuilds', 'overrides'].includes(key)), 'Workspace control fields require explicit review')
  assert.ok(reviewedWorkspaceOverrides && typeof reviewedWorkspaceOverrides === 'object'
    && !Array.isArray(reviewedWorkspaceOverrides), 'Explicit reviewed workspace overrides required')
  assert.deepEqual(workspace.overrides ?? {}, reviewedWorkspaceOverrides, 'Workspace overrides require exact explicit review')
  for (const [selector, version] of Object.entries(reviewedWorkspaceOverrides)) {
    const { name, range } = overrideSelector(selector)
    assert.ok(!host(name) && name !== '@ladybugdb/wasm-core', 'Host and Ladybug selections use their explicit version inputs')
    assert.equal(typeof version, 'string', 'Override must be an exact registry version')
    assert.equal(valid(version), version, 'Override must be an exact canonical registry version')
    if (range) assert.ok(satisfies(version, range), 'Override must preserve the selected compatibility range')
  }
  assert.equal(typeof ladybugVersion, 'string', 'Explicit canonical Ladybug version required')
  assert.equal(valid(ladybugVersion), ladybugVersion, 'Explicit canonical Ladybug version required')
  assert.ok(Array.isArray(rootScripts) && rootScripts.length > 0, 'Explicit reviewed root script list required')
  assert.equal(new Set(rootScripts).size, rootScripts.length, 'Duplicate root script selection')
  assert.ok(rootScriptFileExclusions && typeof rootScriptFileExclusions === 'object' && !Array.isArray(rootScriptFileExclusions), 'Explicit root test exclusions required')
  assert.ok(Object.keys(rootScriptFileExclusions).every(key => rootScripts.includes(key)), 'Unused root test exclusions require review')
  const original = digestable({ root, workspace, packages, officialVersions, rootScripts, rootScriptFileExclusions, reviewedWorkspaceOverrides })
  const output = { root: structuredClone(root), workspace: structuredClone(workspace), packages: structuredClone(packages) }
  const changes = [], used = new Set()
  function change(path, object, field, after, location = field) {
    const before = object[field]
    if (digestable(before) === digestable(after)) return
    changes.push({ path, field: location, before: structuredClone(before), after: structuredClone(after) })
    object[field] = after
  }
  function drop(path, object, field) {
    if (!Object.hasOwn(object, field)) return
    changes.push({ path, field, before: structuredClone(object[field]), removed: true })
    delete object[field]
  }
  for (const [name, version] of Object.entries(officialVersions)) {
    assert.ok(host(name), `Not an explicit official host dependency: ${name}`)
    assert.equal(typeof version, 'string', `Exact canonical official version required: ${name}`)
    assert.equal(valid(version), version, `Exact canonical official version required: ${name}`)
  }
  const names = new Map()
  for (const [path, manifest] of Object.entries(packages)) {
    packagePath(path)
    assert.equal(typeof manifest.name, 'string', 'Package identity required')
    assert.ok(!names.has(manifest.name), 'Duplicate own package identity')
    names.set(manifest.name, path)
  }
  assert.ok(Object.keys(reviewedWorkspaceOverrides).every(selector => !names.has(overrideSelector(selector).name)), 'Own package overrides require a separate release mapping')
  for (const [path, source] of Object.entries(packages)) {
    const manifest = output.packages[path]
    for (const key of ['overrides', 'resolutions', 'pnpm']) assert.ok(!Object.hasOwn(source, key), `${path}: ${key} requires review`)
    for (const field of FIELDS) {
      for (const [name, spec] of Object.entries(source[field] ?? {})) {
        assert.equal(typeof spec, 'string', `${path}: invalid dependency spec`)
        if (host(name)) {
          assert.ok(Object.hasOwn(officialVersions, name), `Official dependency selection missing: ${name}`)
          const version = officialVersions[name]; used.add(name)
          if (field === 'peerDependencies') {
            assert.ok(validRange(spec), `${path}: invalid peer range ${name}`)
            const range = satisfies(version, spec) ? spec : `${spec} || ${version}`
            change(path, manifest[field], name, range, `${field}.${name}`)
          } else {
            if (local(spec)) {
              assert.ok(field === 'devDependencies' && validRange(source.peerDependencies?.[name]),
                `${path}: local host dependency requires a declared development peer`)
            } else assert.ok(validRange(spec), `${path}: invalid official dependency range`)
            change(path, manifest[field], name, version, `${field}.${name}`)
          }
        } else if (name === '@ladybugdb/wasm-core') {
          assert.equal(path, 'packages/knowledge-ladybug/package.json', 'Unknown Ladybug consumer requires review')
          assert.equal(field, 'dependencies', 'Ladybug must remain a runtime dependency')
          assert.ok(spec === 'file:../../vendor/ladybug/runtime' || spec === ladybugVersion, 'Unexpected Ladybug source baseline')
          change(path, manifest[field], name, ladybugVersion, `${field}.${name}`)
        } else if (local(spec)) {
          assert.ok(names.has(name), `${path}: unresolved external local dependency ${name}`)
          if (spec.startsWith('workspace:')) {
            const range = spec.slice('workspace:'.length)
            assert.ok(['*', '^', '~'].includes(range) || validRange(range), 'Unknown own workspace reference')
          } else {
            const match = /^(?:link:|file:)(.+)$/u.exec(spec)
            assert.ok(match && posix.normalize(posix.join(posix.dirname(path), match[1], 'package.json')) === names.get(name),
              `${path}: own dependency path/identity mismatch ${name}`)
          }
          // Own local references are valid inside the exported source workspace.
          // npm manifest rewriting remains the existing release mapper's job.
        }
      }
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(officialVersions).sort(), 'Unused official selections require explicit review')
  const scripts = {}
  for (const key of rootScripts) {
    assert.ok(Object.hasOwn(root.scripts ?? {}, key), `Selected script is missing: ${key}`)
    const command = root.scripts[key]
    assert.equal(typeof command, 'string', 'Script command must be text')
    assert.ok(!/(?:deepseek-harness|dogfood|start\.sh|start-panel-lab|\.env|gitlab\.alibaba-inc)/iu.test(`${key} ${command}`),
      `Development-only root script cannot be exported: ${key}`)
    const excluded = Object.hasOwn(rootScriptFileExclusions, key) ? rootScriptFileExclusions[key] : []
    assert.ok(Array.isArray(excluded) && new Set(excluded).size === excluded.length, 'Duplicate or invalid root test exclusion')
    if (excluded.length) {
      // Only a flat, explicit Node test-file list is supported. Never rewrite
      // shell commands, flags, globs or substrings to bypass a test gate.
      const tokens = command.split(/\s+/u)
      assert.deepEqual(tokens.slice(0, 2), ['node', '--test'], 'Root exclusion requires an explicit Node test-file list')
      const files = tokens.slice(2)
      assert.ok(files.length && files.every(file => /^(?:scripts|packages)\/[a-zA-Z0-9_./-]+\.mjs$/u.test(file)
        && file.split('/').every(part => part && part !== '.' && part !== '..')), 'Root test command is not a flat file list')
      for (const file of excluded) {
        assert.equal(typeof file, 'string', 'Root test exclusion must be an exact filename')
        assert.equal(files.filter(value => value === file).length, 1, 'Root test exclusion must match exactly one existing file')
      }
      const kept = files.filter(file => !excluded.includes(file))
      assert.ok(kept.length, 'Root test exclusion cannot empty a suite')
      scripts[key] = ['node', '--test', ...kept].join(' ')
    } else scripts[key] = command
  }
  change('package.json', output.root, 'scripts', scripts)
  drop('package.json', output.root, 'repository') // Public remote is not assigned yet.
  drop('package.json', output.root, 'main') // A private source workspace is not a library entry.
  for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(root[field] ?? {})) {
      assert.equal(typeof spec, 'string', 'Invalid root dependency')
      assert.ok(!local(spec), `Root local dependency requires review: ${name}`)
      assert.ok(!host(name), `Root host dependency needs an explicit projection policy: ${name}`)
    }
  }
  // These can override selections or hide unavailable peers. Do not silently
  // discard them or manufacture a host's transitive dependency control plane.
  for (const key of ['overrides', 'resolutions', 'pnpm']) assert.ok(!Object.hasOwn(root, key), `Root ${key} requires review`)
  for (const key of ['packageExtensions', 'catalog', 'catalogs', 'autoInstallPeers', 'strictPeerDependencies']) {
    assert.ok(!Object.hasOwn(workspace, key), `Workspace ${key} requires explicit review`)
  }
  assert.equal(digestable({ root, workspace, packages, officialVersions, rootScripts, rootScriptFileExclusions, reviewedWorkspaceOverrides }), original, 'Inputs must remain unchanged')
  return { kind: 'public-source-config-proposal', schemaVersion: 1, ...output, changes,
    officialVersions: { ...officialVersions }, ladybugVersion, lockAction: 'regenerate-in-isolated-source-candidate',
    releaseApproved: false, installed: false, built: false,
    pending: ['Strict public registry lock/install', 'Official host peer/runtime compatibility',
      'Complete source/build/test file closure', 'npm naming/artifact mapping and real package verification'] }
}
