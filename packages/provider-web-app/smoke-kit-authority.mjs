#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DesignBundleContributionRegistry, deriveDesignBundleAuthorityId, loadDesignKit, validatorFromSchemaYaml } from 'dsh-design-core'
import {
  createWebAppBundleContributions,
  WEB_APP_DRIVER_IDS,
  WEB_APP_KIT_SOURCE_ID,
} from './lib/index.js'

const kitRoot = resolve(import.meta.dirname, '../skills-web-app')
const kitFs = {
  async readText(path) {
    try { return await readFile(path, 'utf8') } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  },
  async listDir(path) { return readdir(path) },
  async isDirectory(path) { return (await stat(path)).isDirectory() },
  realPath: realpath,
}
const kit = await loadDesignKit(kitFs, kitRoot, { sourceId: WEB_APP_KIT_SOURCE_ID })
const registry = new DesignBundleContributionRegistry()
const contributions = createWebAppBundleContributions()
const disposers = contributions.map((contribution) => (
  registry.registerBundleContribution(contribution)
))
// The Provider's retained native inventory is independent of the current Kit's
// presentation modes. Declarative Bundles do not need native registrations.
const authorizedPresentations = [
  ['smart_questions', WEB_APP_DRIVER_IDS.smartQuestions],
  ['research', WEB_APP_DRIVER_IDS.research],
  ['function_modules', WEB_APP_DRIVER_IDS.functionModules],
  ['function_modules', WEB_APP_DRIVER_IDS.legacyFunctionModules],
  ['flow_design', WEB_APP_DRIVER_IDS.flowDesign],
  ['design_style', WEB_APP_DRIVER_IDS.designStyle],
  ['business_data', WEB_APP_DRIVER_IDS.businessData],
  ['business_rules', WEB_APP_DRIVER_IDS.businessRules],
  ['role_access', WEB_APP_DRIVER_IDS.roleAccess],
  ['integration_design', WEB_APP_DRIVER_IDS.integrationDesign],
  ['notification_design', WEB_APP_DRIVER_IDS.notificationDesign],
  ['quality_acceptance', WEB_APP_DRIVER_IDS.qualityAcceptance],
  ['page_design', WEB_APP_DRIVER_IDS.pageDesign],
  ['web_app_prd_assembly', WEB_APP_DRIVER_IDS.webAppPrdAssembly],
  ['whiteboard', WEB_APP_DRIVER_IDS.whiteboard],
]
assert.deepEqual(
  contributions.map(({ authority, presentation }) => ({ authority, presentation })),
  authorizedPresentations.map(([name, presentation]) => ({
    authority: deriveDesignBundleAuthorityId(WEB_APP_KIT_SOURCE_ID, name), presentation,
  })),
  'exact authorized native presentations and the legacy function renderer are retained',
)
registry.assertKit(kit)
const emptyRegistry = new DesignBundleContributionRegistry()
for (const skill of kit.skills) {
  const presentation = skill.metadata?.skillManifest?.presentation
  if (presentation?.mode === 'native') {
    registry.requirePresentation(skill.authority, presentation.renderer)
    assert.throws(() => emptyRegistry.requirePresentation(skill.authority, presentation.renderer), /is not installed/)
  } else if (presentation?.mode === 'declarative') {
    assert.doesNotThrow(() => emptyRegistry.assertKit({ ...kit, skills: [skill] }),
      `${skill.name}: declarative presentation has no native renderer requirement`)
  }
}
// Synthetic reference-only fixtures exercise native authorization even after
// all current content migrates to declarative. They do not change loaded content
// or prove that a synthetic native Bundle passes the content compiler.
const currentNativePresentations = new Map(authorizedPresentations.filter(([, id]) => id !== WEB_APP_DRIVER_IDS.legacyFunctionModules))
function nativeReferenceKit(sourceKit) {
  return { ...sourceKit, skills: sourceKit.skills.flatMap(skill => {
    const renderer = currentNativePresentations.get(skill.name)
    return renderer === undefined ? [] : [{ ...skill, metadata: {
      skillManifest: { presentation: { mode: 'native', renderer } },
    } }]
  }) }
}
assert.throws(() => emptyRegistry.assertKit(nativeReferenceKit(kit)), /is not installed/,
  'native references still require an installed presentation')
registry.assertKit(nativeReferenceKit(kit))
// Retired confirmation markers never block loading or saving legacy content.
for (const [name, current, record] of [
  ['design_style', { config: { theme: 'Workspace', notes: 'Keep my design' } }, state => state.config],
  ['flow_design', { processes: { P1: { process_id: 'P1', title: 'Checkout', bpmn_file: 'flow_design/P1.bpmn' } }, process_order: ['P1'] }, state => state.processes.P1],
]) {
  const validate = validatorFromSchemaYaml(await readFile(resolve(kitRoot, 'bundles', name, 'schema.yaml'), 'utf8'))
  assert.deepEqual(validate(current), { ok: true })
  for (const confirmed of [false, true]) {
    const legacy = structuredClone(current)
    record(legacy).is_confirmed = confirmed
    record(legacy).legacy_note = 'Preserve unrelated data'
    const loaded = JSON.parse(JSON.stringify(legacy))
    assert.deepEqual(validate(loaded), { ok: true }, `${name}: legacy file loads`)
    record(loaded).notes = 'User edit'
    assert.deepEqual(validate(loaded), { ok: true }, `${name}: legacy file remains saveable`)
    delete record(loaded).is_confirmed
    assert.deepEqual(validate(loaded), { ok: true }, `${name}: marker-free revision saves`)
    assert.equal(record(loaded).legacy_note, 'Preserve unrelated data')
  }
}
assert.ok(contributions.every(contribution => contribution.runtime === undefined), 'Provider contributions must remain presentation-only')
assert.ok(
  kit.skills.every((skill) => skill.execution?.handoff !== undefined),
  'DesignSkill.execution manifest handoff remains authoritative',
)

const copiedKit = await loadDesignKit(kitFs, kitRoot, { sourceId: 'package:copied-web-app-kit' })
assert.equal(copiedKit.name, kit.name, 'deployment source identity must not change the published Kit name')
assert.equal(copiedKit.version, kit.version, 'deployment source identity must not change the published Kit version')
assert.deepEqual(
  copiedKit.skills.map((skill) => ({ name: skill.name, version: skill.version })),
  kit.skills.map((skill) => ({ name: skill.name, version: skill.version })),
  'deployment source identity must not change published Bundle names and versions',
)
assert.notDeepEqual(
  copiedKit.skills.map((skill) => skill.authority),
  kit.skills.map((skill) => skill.authority),
  'deployment source identity must change executable Bundle authority',
)
assert.throws(
  () => registry.assertKit(nativeReferenceKit(copiedKit)),
  /not authorized for Bundle authority/,
  'copied driver ids do not inherit the official package authority',
)
for (const dispose of disposers.reverse()) dispose()

console.log('WEB APP KIT AUTHORITY REGISTRATION OK')
