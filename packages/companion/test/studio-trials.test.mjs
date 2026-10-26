import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudioTrials, createStudioTrialInputGate } from '../src/studio-trials.mjs'
import { createStudioPanelDrafts, createStudioDraftPorts } from '../src/studio-panel-drafts.mjs'
import { loadStudioKit } from '../../studio/src/load.ts'
import { companionFs } from '../src/project.mjs'

const packageRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
let kitRoot
before(async () => {
  // Retain the legacy fixture boundary without restoring embedded production Bundles.
  kitRoot = await mkdtemp(join(tmpdir(), 'studio-legacy-trial-kit-'))
  await cp(join(packageRoot, 'kits/web_app/mindset.md'), join(kitRoot, 'mindset.md'))
  if ((await readdir(join(packageRoot, 'kits/web_app'))).includes('relations.yaml')) {
    await cp(join(packageRoot, 'kits/web_app/relations.yaml'), join(kitRoot, 'relations.yaml'))
  }
  await cp(join(packageRoot, 'bundles'), join(kitRoot, 'skills'), { recursive: true })
})
after(async () => { if (kitRoot) await rm(kitRoot, { recursive: true, force: true }) })
const kit = { name: 'web_app', version: '1.1' }, bundle = { name: 'business_rules', version: '1.0' }
const source = { kind: 'installed', kit, bundle }

test('independent trial materializes the retained closure and overlays the real Bundle root', async t => {
  const sourceRoot = join(packageRoot, 'kits/web_app')
  const locations = (await readdir(join(packageRoot, 'bundles'))).map(name => ({ name, version: name === 'flow_design' ? '1.1' : '1.0', rootDir: join(packageRoot, 'bundles', name), sourceId: 'fixture:trial-origin' }))
  const installed = await loadStudioKit(companionFs, sourceRoot, { bundles: locations })
  const { service, options, starts } = await fixture(t, { kitRoot: sourceRoot, readInstalledKit: () => installed,
    readInstalledBundle: pin => { const entry = locations.find(location => location.name === pin.name); return { resourceRoot: entry.rootDir, sourceId: entry.sourceId } } })
  const drafts = await createStudioPanelDrafts(options), draft = await drafts.create({ kit, bundle })
  const panelSource = draft.panelSource + '\n# independent trial overlay\n'
  const saved = await drafts.save({ ...draft, expectedRevision: 0, panelSource })
  const result = await service.start({ source: { kind: 'panel-draft', kit, bundle, id: saved.id, expectedRevision: saved.revision }, task: 'Use isolated sample data.' })
  assert.equal(result.status, 'queued')
  assert.match(starts[0].kitRoot, /kits\/web_app$/)
  const compiled = await loadStudioKit(companionFs, starts[0].kitRoot, starts[0].trustedContentSources)
  const target = compiled.skills.find(skill => skill.name === bundle.name)
  assert.match(target.resourceRoot, /bundles\/business_rules$/)
  assert.equal(await readFile(join(target.resourceRoot, 'panel.yaml'), 'utf8'), panelSource)
  assert.equal(target.authority, installed.skills.find(skill => skill.name === bundle.name).authority)
  await assert.rejects(readFile(join(starts[0].kitRoot, 'skills/business_rules/panel.yaml')), { code: 'ENOENT' })
  assert.notEqual(await readFile(join(packageRoot, 'bundles/business_rules/panel.yaml'), 'utf8'), panelSource)
})
async function fixture(t, overrides = {}) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-trial-test-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const starts = [], sends = [], closes = []
  const options = { stateRoot, kitRoot, readInstalledKit: () => kit, connection: { threadId: 'fixture-parent', send: async () => ({ accepted: true }) },
    startCompanion: async input => {
      starts.push(input)
      return { origin: 'http://127.0.0.1:32123', url: 'http://127.0.0.1:32123/#fixture', connectionPath: join(input.stateRoot, 'fixture-connection.json'),
        project: { sendPrompt: async prompt => { sends.push(prompt); return { accepted: true } } }, close: async () => { closes.push(input) } }
    }, ...overrides }
  const service = await createStudioTrials(options)
  t.after(() => service.close())
  return { service, options, starts, sends, closes, stateRoot }
}

test('real source snapshot and Git project; queued is not completed; reopen retains unknown', async t => {
  const { service, options, starts, sends, stateRoot } = await fixture(t)
  const original = await readFile(join(kitRoot, 'skills/business_rules/panel.yaml'))
  const result = await service.start({ source, task: 'Generate a synthetic rule only.' })
  assert.equal(result.status, 'queued')
  assert.equal(result.inputMode, 'manual')
  assert.equal(result.task, 'Generate a synthetic rule only.')
  assert.equal(Object.hasOwn(result, 'locale'), false, 'older callers are not assigned an invented language')
  assert.deepEqual(result.source, source)
  assert.equal(starts.length, 1)
  assert.equal(starts[0].backgroundReviews, false)
  assert.equal(starts[0].studioTrial, true)
  assert.ok(starts[0].projectRoot.startsWith(join(stateRoot, 'studio-trials', result.id)))
  assert.deepEqual(await readFile(join(starts[0].kitRoot, 'skills/business_rules/panel.yaml')), original)
  const metadata = JSON.parse(await readFile(join(starts[0].projectRoot, 'project.json'), 'utf8'))
  assert.deepEqual(metadata.kit, kit)
  assert.match(sends[0].text, new RegExp(result.id))
  assert.equal((await service.read(result.id)).status, 'unknown')
  await assert.rejects(service.stop(result.id), /does not support/)
  await assert.rejects(service.remove(result.id), /unverified/)
  const reopened = await createStudioTrials(options)
  t.after(() => reopened.close())
  const records = await reopened.list()
  assert.equal(records.length, 1)
  assert.equal(records[0].status, 'unknown')
  assert.equal(records[0].resultUrl, undefined)
  assert.deepEqual(await readFile(join(kitRoot, 'skills/business_rules/panel.yaml')), original)
  assert.equal(starts.length, 1, 'no automatic restart or redispatch')
})

test('saved panel revision is overlaid, stale draft is rejected before launch', async t => {
  const { service, options, starts } = await fixture(t)
  const drafts = await createStudioPanelDrafts(options)
  const draft = await drafts.create({ kit, bundle })
  const panelSource = draft.panelSource + '\n# retained trial edit\n'
  const saved = await drafts.save({ id: draft.id, expectedRevision: 0, panelSource, sampleSource: draft.sampleSource })
  const draftSource = { kind: 'panel-draft', id: draft.id, expectedRevision: saved.revision, kit, bundle }
  const result = await service.start({ source: draftSource, task: 'Inspect the saved draft.' })
  assert.equal(result.status, 'queued')
  assert.equal(await readFile(join(starts[0].kitRoot, 'skills/business_rules/panel.yaml'), 'utf8'), panelSource)
  await assert.rejects(service.start({ source: { ...draftSource, expectedRevision: 0 }, task: 'No stale execution.' }), /changed/)
  assert.equal(starts.length, 1)
})

test('pre-dispatch failure is removable; uncertain dispatch never is', async t => {
  const before = await fixture(t, { startCompanion: async () => { throw new Error('Fixture startup failure') } })
  const failed = await before.service.start({ source, task: 'Startup failure fixture.' })
  assert.equal(failed.status, 'failed')
  assert.equal((await before.service.remove(failed.id)).removed, true)
  assert.deepEqual(await before.service.list(), [])
  const after = await fixture(t, { startCompanion: async () => ({ origin: 'http://127.0.0.1:32124', url: 'http://127.0.0.1:32124/#fixture',
    project: { sendPrompt: async () => { throw new Error('Fixture unknown delivery') } }, close: async () => {} }) })
  const unknown = await after.service.start({ source, task: 'Unknown delivery fixture.' })
  assert.equal(unknown.status, 'unknown')
  await assert.rejects(after.service.remove(unknown.id), /unverified/)
})

test('trusted terminal evidence must match trial and project identities', async t => {
  let match = false
  const { service } = await fixture(t, { readTrialEvidence: async input => ({ ...input, id: match ? input.id : 'other', status: 'completed' }) })
  const record = await service.start({ source, task: 'Evidence fixture.' })
  assert.equal((await service.read(record.id)).status, 'unknown')
  match = true
  assert.equal((await service.read(record.id)).status, 'completed')
  assert.equal((await service.remove(record.id)).removed, true)
})

test('reject browser paths, arbitrary result URL and symlinked storage', async t => {
  const { service, options, starts } = await fixture(t)
  await assert.rejects(service.start({ source: { ...source, path: '/outside' }, task: 'Reject path.' }), /source/)
  await assert.rejects(service.read('../escape'), /identity/)
  assert.equal(starts.length, 0)
  const external = await fixture(t, { startCompanion: async () => ({ origin: 'https://example.com', url: 'https://example.com/', close: async () => {} }) })
  assert.equal((await external.service.start({ source, task: 'Reject external URL.' })).status, 'failed')
  const unsafe = await mkdtemp(join(tmpdir(), 'studio-trial-unsafe-'))
  t.after(() => rm(unsafe, { recursive: true, force: true }))
  await symlink(options.stateRoot, join(unsafe, 'studio-trials'))
  await assert.rejects(createStudioTrials({ ...options, stateRoot: unsafe }), /Unsafe/)
})

test('snapshot byte reader preserves arbitrary binary content without text decoding', async t => {
  const { options } = await fixture(t)
  const miniature = await mkdtemp(join(tmpdir(), 'studio-binary-source-'))
  t.after(() => rm(miniature, { recursive: true, force: true }))
  const bytes = Buffer.from([0, 255, 128, 0, 13, 10])
  await writeFile(join(miniature, 'sample.bin'), bytes)
  const { sources } = await createStudioDraftPorts({ ...options, kitRoot: miniature }, 'panel')
  const snapshot = await sources.capture(kit)
  assert.deepEqual(await snapshot.fs.readBytes(join(snapshot.root, 'sample.bin')), bytes)
  await assert.rejects(snapshot.fs.readText(join(snapshot.root, 'sample.bin')))
  await assert.rejects(snapshot.fs.readBytes(join(snapshot.root, '../escape')), /escapes/)
})

test('default child evidence is consumed and close attempts every owned server after an error', async t => {
  let closes = 0, firstFailure = true
  const { service } = await fixture(t, { startCompanion: async input => {
    const metadata = JSON.parse(await readFile(join(input.projectRoot, 'project.json'), 'utf8'))
    return { origin: 'http://127.0.0.1:32125', url: 'http://127.0.0.1:32125/#fixture',
      project: { sendPrompt: async () => ({ accepted: true }) },
      readTrialEvidence: async request => ({ id: request.id, projectId: metadata.id, status: 'completed' }),
      close: async () => { closes++; if (firstFailure) { firstFailure = false; throw new Error('Fixture close failure') } } }
  } })
  const first = await service.start({ source, task: 'First fixture.' })
  await service.start({ source, task: 'Second fixture.' })
  assert.equal((await service.read(first.id)).status, 'completed')
  await assert.rejects(service.close(), /could not be closed/)
  assert.equal(closes, 2)
  await service.close()
  assert.equal(closes, 3, 'failed owned server remains available for cleanup retry')
})

test('generated first run records exact input once before execution and survives reopen', async t => {
  let evidenceStatus = 'completed'
  const { service, options, starts, sends } = await fixture(t, { readTrialEvidence: async input => ({ ...input, status: evidenceStatus }) })
  const result = await service.start({ source })
  assert.equal(result.status, 'preparing')
  assert.equal(result.inputMode, 'generated')
  assert.equal(result.task, undefined)
  assert.match(sends[0].text, /design_prepare_bundle/)
  assert.match(sends[0].text, /design_submit_trial_input/)
  assert.equal((await service.read(result.id)).status, 'preparing', 'missing receipt cannot complete')
  const gate = createStudioTrialInputGate(starts[0].trialInput)
  await assert.rejects(gate.assertExecution({ skill: bundle.name }), /Record generated/)
  await assert.rejects(gate.submit({ trialId: result.id, task: 'No Bundle name' }), /include/)
  await assert.rejects(gate.submit({ trialId: 'wrong', task: bundle.name }), /exact owned/)
  const task = 'business_rules: define an approval rule for synthetic expense requests.'
  const saved = await gate.submit({ trialId: result.id, task })
  assert.equal(saved.task, task)
  await assert.rejects(gate.submit({ trialId: result.id, task: task + ' replacement' }), /overwritten/)
  await gate.assertExecution({ skill: bundle.name })
  await assert.rejects(gate.assertExecution({ skill: 'business_data' }), /bound trial/)
  const reopened = await createStudioTrials(options)
  t.after(() => reopened.close())
  assert.equal((await reopened.read(result.id)).task, task)
  assert.equal((await service.read(result.id)).status, 'completed')
  evidenceStatus = 'waiting'
})

test('manual input never regenerates; invalid input and unowned receipts reject', async t => {
  const { service, starts, sends } = await fixture(t)
  for (const task of ['', '   ', null, '中'.repeat(12000)]) await assert.rejects(service.start({ source, task }), /bounded task/)
  const record = await service.start({ source, task: 'exact manual text' })
  assert.match(sends[0].text, /without generating replacement/)
  assert.match(sends[0].text, /exact manual text/)
  const gate = createStudioTrialInputGate(starts[0].trialInput)
  await gate.assertExecution({ skill: bundle.name })
  await assert.rejects(gate.submit({ trialId: record.id, task: bundle.name }), /Generated input/)
  await assert.rejects(createStudioTrialInputGate().submit({ trialId: record.id, task: bundle.name }), /owned trial/)
})

test('same-source unknown/preparing/running blocks reentry; waiting starts a distinct isolated round', async t => {
  let status = 'running'
  const { service, starts } = await fixture(t, { readTrialEvidence: async input => ({ ...input, status }) })
  const first = await service.start({ source, task: 'first user input' })
  await assert.rejects(service.start({ source: { bundle, kit, kind: 'installed' }, task: 'duplicate' }), /active or unverified/)
  status = 'waiting'
  const second = await service.start({ source, task: 'edited input' })
  assert.notEqual(first.id, second.id)
  assert.notEqual(starts[0].projectRoot, starts[1].projectRoot)
  assert.equal((await service.read(first.id)).status, 'waiting')
  await assert.rejects(service.remove(first.id), /unverified/)
})

test('a receipt arriving during prompt dispatch is retained and parallel receipts cannot overwrite', async t => {
  const { service } = await fixture(t, { startCompanion: async input => ({ origin: 'http://127.0.0.1:32126', url: 'http://127.0.0.1:32126/#fixture', close: async () => {},
    project: { sendPrompt: async () => {
      const gate = createStudioTrialInputGate(input.trialInput)
      const results = await Promise.allSettled([1, 2].map(n => gate.submit({ trialId: input.trialInput.id, task: `business_rules synthetic ${n}` })))
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      return { accepted: true }
    } } }) })
  const record = await service.start({ source })
  assert.match(record.task, /^business_rules synthetic [12]$/)
  assert.equal(record.status, 'queued')
})

for (const locale of ['zh-CN', 'en-US']) {
  test(`generated ${locale} language is durable, delegated and retained through input receipt`, async t => {
    const { service, options, starts, sends, stateRoot } = await fixture(t)
    const result = await service.start({ source, locale })
    assert.equal(result.locale, locale)
    assert.equal(starts[0].trialInput.locale, locale)
    assert.match(sends[0].text, new RegExp(`Trial output language: ${locale}`))
    assert.match(sends[0].text, /generated test input and human-facing Panel content/)
    assert.match(sends[0].text, /Preserve technical identifiers, schema keys, Bundle names, paths, version pins and code/)
    assert.match(sends[0].text, /native Producer\/Worker delegation/)
    assert.equal(JSON.parse(await readFile(join(stateRoot, 'studio-trials', `${result.id}.json`), 'utf8')).locale, locale)
    await assert.rejects(service.start({ source, locale: locale === 'zh-CN' ? 'en-US' : 'zh-CN' }), /active or unverified/, 'another language cannot bypass source reentry')
    const task = locale === 'zh-CN' ? 'business_rules：校验合成申请的金额与审核权限。' : 'business_rules: validate synthetic request amount and reviewer access.'
    const receipt = await createStudioTrialInputGate(starts[0].trialInput).submit({ trialId: result.id, task })
    assert.equal(receipt.locale, locale); assert.equal(receipt.task, task)
    assert.equal((await service.read(result.id)).locale, locale)
    assert.equal((await service.list())[0].locale, locale)
    const reopened = await createStudioTrials(options)
    t.after(() => reopened.close())
    assert.equal((await reopened.read(result.id)).locale, locale)
    assert.equal((await reopened.read(result.id)).task, task)
    assert.equal(starts.length, 1); assert.equal(sends.length, 1, 'reopen and receipt do not redispatch')
  })

  test(`manual ${locale} language setting preserves exact mixed-language user input`, async t => {
    const { service, starts, sends, stateRoot } = await fixture(t)
    const task = '  用户原文 / original task\r\n\tKeep ID_business_rules_01 and JSON keys unchanged.\n  '
    const result = await service.start({ source, locale, task })
    assert.equal(result.locale, locale); assert.equal(result.task, task)
    assert.equal(result.inputMode, 'manual')
    assert.equal(JSON.parse(await readFile(join(stateRoot, 'studio-trials', `${result.id}.json`), 'utf8')).task, task)
    assert.ok(sends[0].text.endsWith(`Use this exact user-edited input without generating replacement input:\n\n${task}`))
    assert.match(sends[0].text, new RegExp(`Trial output language: ${locale}`))
    assert.match(sends[0].text, /Preserve user-edited task text verbatim/)
    await assert.rejects(createStudioTrialInputGate(starts[0].trialInput).submit({ trialId: result.id, task }), /Generated input/)
    assert.equal(starts.length, 1)
  })
}

test('invalid locale is rejected before snapshot, project creation and native dispatch', async t => {
  let creates = 0
  const { service, starts, sends, stateRoot } = await fixture(t, { createProject: () => { creates++; throw new Error('Unexpected project creation') } })
  for (const locale of [null, '', 'zh', 'en', 'zh_CN', 'en_US', 'fr-FR', {}, ['zh-CN'], 1]) {
    await assert.rejects(service.start({ source, locale }), /locale/)
  }
  assert.equal(creates, 0); assert.equal(starts.length, 0); assert.equal(sends.length, 0)
  assert.deepEqual(await service.list(), [])
  assert.deepEqual(await (await import('node:fs/promises')).readdir(join(stateRoot, 'studio-trials')), [])
})
