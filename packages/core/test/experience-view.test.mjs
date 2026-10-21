import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
const { register } = await import('tsx/esm/api'); register()
const { DesignFilesStore } = await import('../src/design-files.ts')
const { GitVersioning } = await import('../src/git.ts')
const { nodeFs } = await import('../src/service-tools.ts')
const { operateExperience } = await import('../src/experience-service.ts')
const { readExperienceView, experienceFreshness, experienceFeedback, experienceResource } = await import('../src/experience-view.ts')
const { projectWorktreeDesign } = await import('../src/panel-worktree.ts')
const exec = promisify(execFile)
test('managed review snapshot excludes derived views but preserves owning evidence', async () => {
  const { reviewSnapshot } = await import('../../companion/src/managed-reviews.mjs')
  const root = await mkdtemp(join(tmpdir(), 'experience-review-test-'))
  let snapshot
  try {
    await mkdir(join(root, 'design_files/intent'), { recursive: true })
    await mkdir(join(root, 'design_files/_experiences/paper'), { recursive: true })
    await writeFile(join(root, 'design_files/intent/intent.json'), '{"goal":"owner fact"}')
    await writeFile(join(root, 'design_files/_experiences/paper/view.json'), '{"demo":"not evidence"}')
    await exec('git', ['init', root])
    await exec('git', ['-C', root, 'add', 'design_files'])
    await exec('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'fixture'])
    const { stdout } = await exec('git', ['-C', root, 'rev-parse', 'HEAD'])
    snapshot = await reviewSnapshot(root, stdout.trim())
    assert.match(await readFile(join(snapshot.root, 'design_files/intent/intent.json'), 'utf8'), /owner fact/)
    await assert.rejects(readFile(join(snapshot.root, 'design_files/_experiences/paper/view.json')), { code: 'ENOENT' })
  } finally { await snapshot?.close(); await rm(root, { recursive: true, force: true }) }
})
const digest = value => createHash('sha256').update(value).digest('hex')
const source = 'intent/intent.json'
const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>前后对比，不是页面步骤</body></html>'
test('section evidence requires captured own keys, not inherited object properties', () => {
  const view = {
    id: 'generic', version: 'v1', title: 'Comparison', purpose: 'Understand a bounded decision',
    sourceVersions: { [source]: digest('saved source') },
    sections: [{ id: 'comparison', title: 'Comparison', htmlFile: '_experiences/generic/v1/comparison.html', sources: [source], assumptions: [] }],
  }
  assert.equal(readExperienceView(view), view)
  for (const path of ['constructor', 'toString', 'hasOwnProperty']) {
    const invalid = { ...view, sections: [{ ...view.sections[0], sources: [path] }] }
    assert.throws(() => readExperienceView(invalid), /Section evidence must reference captured sources/)
    // Such a filename is valid when it is genuinely present in the captured map.
    const captured = { ...invalid, sourceVersions: { ...view.sourceVersions, [path]: digest('own captured source') } }
    assert.equal(readExperienceView(captured), captured)
  }
  const inheritedCss = Object.assign(Object.create({ 'theme.css': digest('inherited CSS') }), view.sourceVersions)
  assert.throws(() => readExperienceView({ ...view, sourceVersions: inheritedCss, stylesheet: 'theme.css' }), /Stylesheet must be a captured CSS source/)
  const capturedCss = { ...view, sourceVersions: { ...view.sourceVersions, 'theme.css': digest('captured CSS') }, stylesheet: 'theme.css' }
  assert.equal(readExperienceView(capturedCss), capturedCss)
})
test('product tree identity excludes only root experiences, preserving path/type/mode/content and failing closed', async () => fixture(async ({ root, git, store }) => {
  const base = await store.head()
  const commit = async entries => git.commitExact('arbitrary message', new Map(entries), await store.head())
  const one = await commit([['_experiences/demo/view.json', 'demo']])
  const two = await commit([['_experiences/demo/view.json', 'changed']])
  const three = await commit([['_experiences/demo/view.json', undefined]])
  for (const head of [one,two,three]) assert.equal(await store.sameDesignEvidenceAt(base,head), true)
  for (const path of ['intent/new.json','intent/page.html','intent/style.css','intent/logo.png','intent/_experiences/business.json']) {
    const before = await store.head()
    const added = await commit([[path, Buffer.from([1,2,3])]])
    assert.equal(await store.sameDesignEvidenceAt(before,added), false, `add ${path}`)
    const changed = await commit([[path, Buffer.from([3,2,1])]])
    assert.equal(await store.sameDesignEvidenceAt(added,changed), false, `change ${path}`)
    const removed = await commit([[path, undefined]])
    assert.equal(await store.sameDesignEvidenceAt(changed,removed), false, `delete ${path}`)
    assert.equal(await store.sameDesignEvidenceAt(before,removed), true, 'Restored identical evidence is equivalent')
  }
  const mixed = await commit([[source, 'real change'],['_experiences/demo/view.json','demo']])
  assert.equal(await store.sameDesignEvidenceAt(base,mixed), false)
  assert.equal(await store.sameDesignEvidenceAt('f'.repeat(40),mixed), false)
  assert.equal(await store.sameDesignEvidenceAt('f'.repeat(40),'f'.repeat(40)), false)
  assert.equal(await store.sameDesignEvidenceAt('HEAD','HEAD'), false)
  await assert.rejects(store.designEvidenceRevisionAt('HEAD'), /full lowercase/)
  await assert.rejects(store.designEvidenceRevisionAt('f'.repeat(40)))
  const modeBase = await commit([['intent/tool.sh','echo test']])
  await writeFile(join(root,'intent/tool.sh'),'echo test')
  await exec('git', ['-C',root,'update-index','--chmod=+x','intent/tool.sh'])
  await exec('git', ['-C',root,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','mode'])
  assert.equal(await store.sameDesignEvidenceAt(modeBase,await store.head()), false)
  await symlink('intent.json', join(root,'intent/link'))
  await exec('git', ['-C',root,'add','intent/link'])
  await exec('git', ['-C',root,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','type'])
  assert.equal(await store.sameDesignEvidenceAt(modeBase,await store.head()), false)
  const foreign = new GitVersioning(async () => ({ exitCode:0, stdout:'100644 blob abc\tintent/../unsafe\0',stderr:'' }),root)
  await assert.rejects(foreign.designEvidenceRevisionAt(base), /unsafe path/)
}))
test('DSH published inventory survives worktree deletion; derived commit preserves clarity', async () => fixture(async ({ root, store, ready, publish }) => {
  const { DesignPanelRemote } = await import('../src/panel-remote.ts')
  const agent = {}, project = { projectId: 'fixture', name: 'Fixture', root: store.rootDir }
  const kit = { name: 'fixture', version: '1.0', skills: [] }
  const assessedCheckpoint = await store.head()
  const authority = { assessedCheckpoint, report: { kit: kit.name, version: kit.version, u: { score: 60 }, s: { score: 40 }, t: { score: 20 } } }
  const remote = Object.create(DesignPanelRemote.prototype)
  Object.defineProperty(remote, 'worktreeProjections', { value: new Map() })
  Object.defineProperty(remote, 'design', { value: {
    withWorkspaceRead: (_agent, _signal, read) => read(),
    selectedProjectForAgent: async () => project,
    readProjectWorkspaceSnapshot: async () => ({ checkpoint: await store.head(), design: {}, kit }),
    designFilesForProject: async () => store,
    resolveProjectKit: () => kit,
    expectProjectPanelObservation() {},
    readDesignJournal: async () => ({ revision: 0, records: [], snapshot: {} }),
    readClarityAuthority: async () => authority,
    assertProjectSelection() {}, executionAttemptsFor: () => [],
  } })
  const read = () => remote.readWorkspace(agent, new AbortController().signal)
  assert.equal((await read()).clarity.needsReassessment, false)
  const result = await publish(await ready())
  await rm(join(root, result.viewFile))
  const snapshot = await read()
  assert.equal(snapshot.experienceFiles[result.viewFile], result.commit)
  assert.equal(snapshot.clarity.needsReassessment, false)
  assert.equal(authority.assessedCheckpoint, assessedCheckpoint, 'No score or audit pin rewrite')
  assert.equal(snapshot.journalRevision, 0)
  kit.version = '2.0'
  assert.equal((await read()).clarity.needsReassessment, true)
  kit.version = '1.0'
  await store.write('intent', { goal: '真正改变设计' }, { origin: 'agent', settleEvent: async () => {} })
  assert.equal((await read()).clarity.needsReassessment, true)
}))
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'system-experience-test-'))
  const git = new GitVersioning(async ({ argv, cwd, env, signal }) => {
    try { const r = await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } }); return { exitCode: 0, ...r } }
    catch (e) { return { exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } }
  }, root)
  await git.ensureRepo()
  const store = new DesignFilesStore(nodeFs, git, root)
  await store.write('intent', { goal: '理解并保留阅读批注' }, { origin: 'agent', settleEvent: async () => {} })
  const call = args => operateExperience(store, { id: 'reading', ...args })
  const ready = async () => {
    const draft = await call({ action: 'prepare', sources: [source] })
    await call({ action: 'write', version: draft.version, artifactId: 'comparison', content: html })
    return draft.version
  }
  const publish = version => call({ action: 'publish', version, title: '替换论文后，批注怎么办？', purpose: '比较替换前后能保留的内容',
    sections: [{ id: 'comparison', title: '前后对比', sources: [source], assumptions: ['论文内容为演示样例'] }] })
  try { await fn({ root, store, git, call, ready, publish }) } finally { await rm(root, { recursive: true, force: true }) }
}

test('registered tool explains conditional fields and recovers omitted artifactId without re-prepare', async () => fixture(async ({ store }) => {
  const { registerExperienceTool } = await import('../src/dsh-experience-tool.ts')
  let tool
  registerExperienceTool({ tools: { register: definition => { tool = definition } } }, {
    projectForAgent: async () => ({ projectId: 'fixture', designFilesRoot: store.rootDir }),
    withProjectMutationFor: async (_agent, _project, operation) => operation(),
    designFilesForProject: async () => store,
  })
  const params = tool.parameters.properties
  assert.match(params.artifactId.description, /Required for write/)
  assert.match(params.version.description, /Required for write and publish/)
  assert.match(params.sections.items.properties.id.description, /artifactId/)
  // Model calls arrive as JSON: an omitted field is absent, never JS undefined.
  const invoke = args => tool.execute(JSON.parse(JSON.stringify(args)), { agent: {}, signal: new AbortController().signal })
  const prepared = await invoke({ action: 'prepare', id: 'literature-screening-journey', sources: [source] })
  const draft = JSON.parse(prepared.content)
  const { EXPERIENCE_AUTHORING_VERSION, EXPERIENCE_AUTHORING_GUIDE, EXPERIENCE_HTML_STARTER } = await import('../src/experience-authoring.ts')
  assert.match(params.action.description, /authoring.guide/)
  assert.deepEqual(draft.authoring, { version: EXPERIENCE_AUTHORING_VERSION, guide: EXPERIENCE_AUTHORING_GUIDE, htmlStarter: EXPERIENCE_HTML_STARTER })
  assert.equal(draft.authoring.version, 'web-explanation-v1')
  assert.match(draft.authoring.guide, /unresolved product decisions/)
  assert.match(draft.authoring.guide, /same interface/)
  assert.match(draft.authoring.guide, /not just software/)
  assert.match(draft.authoring.guide, /Use a sequence only when order is meaningful/)
  assert.match(draft.authoring.guide, /A static explanation is valid/)
  assert.match(draft.authoring.guide, /visual quality is unverified/)
  assert.match(draft.authoring.htmlStarter, /<figure>/)
  assert.doesNotMatch(draft.authoring.htmlStarter, /<h1[ >]/)
  const args = { action: 'write', id: draft.id, version: draft.version, content: html, offset: 0 }
  const before = await store.listWorktreePaths()
  await assert.rejects(invoke(args), /Missing required artifactId.*sections\[\]\.id.*Keep the prepared id and version/)
  assert.deepEqual(await store.listWorktreePaths(), before)
  await assert.rejects(invoke({ ...args, artifactId: 'overview.html' }), /Invalid artifactId/)
  await assert.rejects(invoke({ ...args, artifactId: 'overview', version: undefined }), /Missing required version/)
  await assert.rejects(invoke({ ...args, artifactId: 'overview', content: undefined }), /write requires nonempty content/)
  const written = JSON.parse((await invoke({ ...draft.writeExample, content: html })).content)
  assert.equal(written.artifactId, 'overview')
  const publish = { action: 'publish', id: draft.id, version: draft.version, title: 'Experience', purpose: 'Judge current design', sections: [{ id: 'overview', title: 'Overview', sources: [source], assumptions: [] }] }
  for (const field of ['title', 'purpose', 'sections']) await assert.rejects(invoke({ ...publish, [field]: undefined }), new RegExp(`publish requires.*${field}`))
  const result = JSON.parse((await invoke(publish)).content)
  assert.equal(result.published, true)
  assert.equal(result.id, draft.id)
  assert.equal(result.version, draft.version)
}))
test('publishes exact view files, preserves unrelated dirty source, not a Bundle projection', async () => fixture(async ({ store, call, ready, publish }) => {
  const version = await ready()
  assert.equal(await store.readWorktreeText('_experiences/reading/view.json'), undefined)
  await store.writeWorktreeText('unrelated/unrelated.json', '{"draft":true}')
  const result = await publish(version)
  const paths = await store.listPathsAt(result.commit)
  assert.ok(!paths.includes('unrelated/unrelated.json'))
  assert.ok(!paths.some(p => p.endsWith('draft.json')))
  const view = readExperienceView(JSON.parse(await store.readWorktreeText(result.viewFile)))
  const snapshot = await projectWorktreeDesign(store, {}, [], result.commit)
  assert.ok(!('_experiences' in snapshot.design))
  assert.equal(experienceFreshness(view, Object.fromEntries([...snapshot.fileDigests].map(([p, v]) => [p, v.sha256]))).status, 'current')
  assert.equal(view.sourceVersions[source], digest(await store.readWorktreeBytes(source)))
  assert.match(experienceFeedback(view, view.sections[0], {}), /前后对比/)
  await assert.rejects(call({ action: 'write', version, artifactId: 'comparison', content: html }), /immutable/)
}))
test('source drift blocks publication, not viewing or feedback; no source write', async () => fixture(async ({ store, ready, publish }) => {
  await publish(await ready())
  const current = await store.readWorktreeText('_experiences/reading/view.json')
  const head = await store.head(), version = await ready()
  await store.writeWorktreeText(source, '{"goal":"新的阅读目标"}')
  await assert.rejects(publish(version), /Source changed/)
  assert.equal(await store.head(), head)
  assert.equal(await store.readWorktreeText('_experiences/reading/view.json'), current)
  const view = readExperienceView(JSON.parse(current))
  assert.equal(experienceFreshness(view, { [source]: digest('changed') }).status, 'stale')
  assert.equal(experienceFreshness(view, {}).status, 'stale')
  assert.equal(experienceFreshness(view).status, 'unknown')
  assert.ok(experienceFeedback(view, view.sections[0], {}).includes('不是接受假设'))
}))
test('stale concurrent draft cannot replace a newer view; prior version remains immutable', async () => fixture(async ({ call, ready, publish }) => {
  const one = await ready(), two = await ready()
  await publish(one)
  await assert.rejects(publish(two), /published view changed/)
  await publish(await ready())
  await assert.rejects(call({ action: 'write', version: one, artifactId: 'comparison', content: html }), /immutable/)
}))
test('bounded UTF-8 append and incomplete output diagnostics', async () => fixture(async ({ call, ready, publish }) => {
  const version = await ready()
  await call({ action: 'write', version, artifactId: 'comparison', content: '<html><body>中文' })
  await assert.rejects(publish(version), /Incomplete HTML/)
  await assert.rejects(call({ action: 'write', version, artifactId: 'comparison', content: '</body></html>', offset: 14 }), /offset/)
  await call({ action: 'write', version, artifactId: 'comparison', content: '</body></html>', offset: Buffer.byteLength('<html><body>中文') })
  await publish(version)
  await assert.rejects(call({ action: 'write', version, artifactId: 'x', content: 'x'.repeat(32769) }), /32 KiB/)
}))
test('path confinement and derived-source recursion rejection', async () => fixture(async ({ root, call }) => {
  for (const path of ['../escape', '/etc/passwd', '_experiences/reading/view.json']) await assert.rejects(call({ action: 'prepare', sources: [path] }))
  await symlink('/etc/hosts', join(root, 'escaped.txt'))
  await assert.rejects(call({ action: 'prepare', sources: ['escaped.txt'] }))
  await assert.rejects(call({ action: 'prepare', sources: ['missing.json'] }), /Missing source/)
  await assert.rejects(call({ action: 'prepare', id: '../bad', sources: [source] }))
}))
test('Git failure leaves previous published view intact and no foreign files committed', async () => fixture(async ({ store, git, ready, publish }) => {
  await publish(await ready())
  const previous = await store.readWorktreeText('_experiences/reading/view.json'), head = await store.head()
  const version = await ready(), commit = git.commitExact
  git.commitExact = async () => { throw new Error('injected Git failure') }
  try { await assert.rejects(publish(version), /injected Git failure/) } finally { git.commitExact = commit }
  assert.equal(await store.readWorktreeText('_experiences/reading/view.json'), previous)
  assert.equal(await store.head(), head)
}))
test('frozen CSS/image bytes survive source removal and other views are preserved', async () => fixture(async ({ store, call, publish }) => {
  const css = ':root{--brand:#123456}', image = Uint8Array.from([137,80,78,71,13,10,26,10])
  await store.writeWorktreeText('visual/tokens.css', css)
  await store.writeWorktreeBytes('visual/logo.png', image)
  const d = await call({ action: 'prepare', sources: [source, 'visual/logo.png'], stylesheet: 'visual/tokens.css' })
  await call({ action: 'write', version: d.version, artifactId: 'comparison', content: html })
  const saved = await publish(d.version)
  const view = readExperienceView(JSON.parse(await store.readTextAt(saved.commit, saved.viewFile)))
  await store.removeWorktreeFile('visual/tokens.css'); await store.removeWorktreeFile('visual/logo.png')
  assert.equal(await store.readTextAt(saved.commit, experienceResource(view, 'visual/tokens.css')), css)
  assert.deepEqual(await store.readWorktreeBytes(experienceResource(view, 'visual/logo.png')), image)
  await store.writeWorktreeText('_experiences/other/view.json', '{"other":true}')
  const d2 = await call({ action: 'prepare', sources: [source] })
  await call({ action: 'write', version: d2.version, artifactId: 'comparison', content: html })
  await publish(d2.version)
  assert.equal(await store.readWorktreeText('_experiences/other/view.json'), '{"other":true}')
  await assert.rejects(store.write('_experiences', {}, { origin: 'agent', ownedArtifacts: [], settleEvent: async () => {} }), /invalid Design File skill/)
}))
test('corrupt prepared metadata fails closed', async () => fixture(async ({ store, ready, publish }) => {
  const version = await ready(), path = `_experiences/reading/${version}/draft.json`
  const original = JSON.parse(await store.readWorktreeText(path))
  for (const bad of [null, { ...original, base: 'bad' }, { ...original, sources: [] }, { ...original, sources: { [source]: 'bad' } }, { ...original, sources: { '../escape': 'a'.repeat(64) } }]) {
    await store.writeWorktreeText(path, JSON.stringify(bad))
    await assert.rejects(publish(version))
    assert.equal(await store.readWorktreeText('_experiences/reading/view.json'), undefined)
  }
}))
