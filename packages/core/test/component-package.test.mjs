import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ComponentPackageError, parseComponentPackageManifest, validateComponentPackageClosure, registerComponentPackageContributions } from '../src/component-package.ts'
import { DesignBundleContributionRegistry, DesignDriverId } from '../src/runtime-drivers.ts'
import { deriveDesignBundleAuthorityId } from '../src/types.ts'
import { validatePanelManifest } from '../src/panel-dsl.ts'
import { fixture, fixtureRoot, host, revise, npmEdit, sourcePin } from './fixtures/component-package/fixture.mjs'

const rejects = (promise, code, path) => assert.rejects(promise, error => error instanceof ComponentPackageError && error.code === code && (!path || error.path === path))
test('real package bytes and Provider entry register through the existing authority registry', async () => {
  const { source, pin } = await fixture()
  assert.deepEqual(sourcePin(source), pin)
  const [checked] = await validateComponentPackageClosure([source], pin, host)
  assert.ok(Object.isFrozen(checked.manifest.components))
  const authority = deriveDesignBundleAuthorityId('package:component-fixture', 'notice')
  const registry = new DesignBundleContributionRegistry()
  const entry = await import(new URL('server.mjs', fixtureRoot))
  const dispose = entry.install(registry, checked, authority, registerComponentPackageContributions)
  const id = DesignDriverId(checked.manifest.components[0].id)
  registry.requirePresentation(authority, id)
  assert.throws(() => registry.requirePresentation(deriveDesignBundleAuthorityId('untrusted-copy', 'notice'), id), /not authorized/)
  assert.throws(() => entry.install(registry, checked, authority, registerComponentPackageContributions), /duplicate/)
  dispose(); dispose()
  assert.throws(() => registry.requirePresentation(authority, id), /not installed/)
  assert.throws(() => registerComponentPackageContributions(registry, { ...checked }, []), /package.unvalidated/)
})

test('readable invalid declarations produce stable locatable diagnostics', async () => {
  const { source, pin } = await fixture()
  const cases = JSON.parse(await readFile(new URL('./fixtures/component-package/invalid-declarations.json', import.meta.url)))
  for (const item of cases) {
    const candidate = revise(source, manifest => {
      let parent = manifest
      for (const key of item.path.slice(0, -1)) parent = parent[key]
      parent[item.path.at(-1)] = item.value
    })
    await rejects(validateComponentPackageClosure([candidate], pin, host), item.code, item.diagnosticPath)
  }
  // The DSL catalog remains closed: admitting Provider metadata does not register a DSL kind.
  const errors = validatePanelManifest({ version: 1, panel_kind: 'fixture', sections: [], fields: [], ui: { id: 'root', component: 'org.example.notice.panel/v1' } })
  assert.ok(errors.some(error => /component/.test(error)))
})

test('byte integrity, inventory, host compatibility, npm identity and React dependencies fail closed', async () => {
  const { source, pin } = await fixture()
  const tampered = { ...source, files: new Map(source.files) }; tampered.files.set('client.mjs', Buffer.from('different bytes'))
  await rejects(validateComponentPackageClosure([tampered], pin, host), 'package.digest')
  const extra = { ...source, files: new Map(source.files) }; extra.files.set('extra.mjs', Buffer.from('unlisted'))
  await rejects(validateComponentPackageClosure([extra], pin, host), 'package.inventory')
  await rejects(validateComponentPackageClosure([source], { ...pin, integrity: '0'.repeat(64) }, host), 'package.dependency_pin', '$root')
  await rejects(validateComponentPackageClosure([source], pin, { ...host, reactVersion: '19.0.0' }), 'package.host', '$host')
  const wrongVersion = revise(source, () => {}, files => npmEdit(files, npm => { npm.version = '2.0.0' }))
  await rejects(validateComponentPackageClosure([wrongVersion], sourcePin(wrongVersion), host), 'package.identity', 'package.json')
  const bundledReact = revise(source, () => {}, files => npmEdit(files, npm => { npm.dependencies = { react: '18.3.1' } }))
  await rejects(validateComponentPackageClosure([bundledReact], sourcePin(bundledReact), host), 'package.dependencies')
  const peer19 = revise(source, () => {}, files => npmEdit(files, npm => { npm.peerDependencies.react = '^19.0.0' }))
  await rejects(validateComponentPackageClosure([peer19], sourcePin(peer19), host), 'package.react_peer', 'package.json.peerDependencies.react')
  const unknownPeer = revise(source, () => {}, files => npmEdit(files, npm => { npm.peerDependencies.privateModule = '*' }))
  await rejects(validateComponentPackageClosure([unknownPeer], sourcePin(unknownPeer), host), 'package.dependencies', 'package.json.peerDependencies')
  const license = revise(source, () => {}, files => files.set('LICENSE', Buffer.alloc(0)))
  await rejects(validateComponentPackageClosure([license], sourcePin(license), host), 'package.license', '$.license.file')
})

test('admission snapshots caller-owned bytes and retains the original live-reference disposal guard', async () => {
  const { source, pin } = await fixture()
  const admission = validateComponentPackageClosure([source], pin, host)
  source.manifest.fill(0); source.files.get('client.mjs').fill(0)
  const [checked] = await admission
  assert.equal(checked.integrity, pin.integrity)
  const authority = deriveDesignBundleAuthorityId('package:fixture', 'notice')
  let live = true
  const registry = new DesignBundleContributionRegistry(() => live ? 'fixture live Kit reference' : undefined)
  const stop = registerComponentPackageContributions(registry, checked, [{ authority, presentation: DesignDriverId(checked.manifest.components[0].id) }])
  assert.throws(stop, /live Kit reference/)
  registry.requirePresentation(authority, DesignDriverId(checked.manifest.components[0].id))
  live = false; stop()
  assert.throws(() => registry.requirePresentation(authority, DesignDriverId(checked.manifest.components[0].id)), /not installed/)
})

test('complete exact closure is ordered, namespace-safe, cycle-free and rejects missing or unused packages', async () => {
  const { source } = await fixture()
  const dependency = revise(source, m => { m.name = '@example/notice-base'; m.namespace = 'org.example.base'; m.components[0].id = 'org.example.base.panel/v1' }, files => npmEdit(files, npm => { npm.name = '@example/notice-base' }))
  const depPin = sourcePin(dependency)
  const root = revise(source, m => { m.dependencies = [depPin] }, files => npmEdit(files, npm => { npm.dependencies = { [depPin.name]: depPin.version } }))
  const rootPin = sourcePin(root)
  const result = await validateComponentPackageClosure([root, dependency], rootPin, host)
  assert.deepEqual(result.map(p => p.name), [depPin.name, rootPin.name])
  await rejects(validateComponentPackageClosure([root], rootPin, host), 'package.dependency_pin')
  await rejects(validateComponentPackageClosure([source, dependency], sourcePin(source), host), 'package.closure')
  const conflict = revise(dependency, m => { m.namespace = 'org.example.notice'; m.components[0].id = 'org.example.notice.other/v1' })
  await rejects(validateComponentPackageClosure([source, conflict], sourcePin(source), host), 'package.namespace_conflict')
  const cyclicDep = revise(dependency, m => { m.dependencies = [{ ...sourcePin(source), integrity: '0'.repeat(64) }] }, files => npmEdit(files, npm => { npm.dependencies = { [sourcePin(source).name]: '1.0.0' } }))
  const cyclicRoot = revise(source, m => { m.dependencies = [sourcePin(cyclicDep)] }, files => npmEdit(files, npm => { npm.dependencies = { [depPin.name]: '1.0.0' } }))
  await rejects(validateComponentPackageClosure([cyclicRoot, cyclicDep], sourcePin(cyclicRoot), host), 'package.dependency_cycle')
})

test('unsupported executable claims and server registration conflicts leave prior owners intact', async () => {
  const { source, pin } = await fixture()
  const [checked] = await validateComponentPackageClosure([source], pin, host)
  const registry = new DesignBundleContributionRegistry(), authority = deriveDesignBundleAuthorityId('package:fixture', 'notice')
  assert.throws(() => registerComponentPackageContributions(registry, checked, [{ authority, presentation: checked.manifest.components[0].id, capabilities: [] }]), /package.contributions/)
  const two = revise(source, m => { m.components.push({ id: 'org.example.notice.second/v1', kind: 'native-panel', summary: 'Second fixture' }) })
  const [second] = await validateComponentPackageClosure([two], sourcePin(two), host)
  const existing = registry.registerBundleContribution({ authority, presentation: DesignDriverId('org.example.notice.second/v1') })
  assert.throws(() => registerComponentPackageContributions(registry, second, second.manifest.components.map(c => ({ authority, presentation: c.id }))), /duplicate/)
  registry.requirePresentation(authority, DesignDriverId('org.example.notice.second/v1'))
  assert.throws(() => registry.requirePresentation(authority, DesignDriverId('org.example.notice.panel/v1')), /not installed/)
  existing()
})
