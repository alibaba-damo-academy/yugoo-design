import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageWorkBuddyProbe, packageWorkBuddySkillConnector, packageWorkBuddyProbeMarketplace } from '../workbuddy-package.mjs'
import { workBuddyProbeContext } from '../src/workbuddy-context-probe.mjs'
import { createWorkBuddyPanelMcp } from '../src/workbuddy-panel-mcp.mjs'

test('WorkBuddy panel metadata preserves conditional GRA and never grants background execution', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000001'
  for (const browserAccess of ['local', 'token']) for (const view of ['full', 'panel-only']) {
    const starts = []
    const mcp = createWorkBuddyPanelMcp({ runtimeRoot: '/installed/runtime', stateRoot: '/owned/state', browserAccess,
      start: async options => {
        starts.push(options)
        return { connectionPath: '/owned/state/connections/exact.json', threadId: sessionId,
          projectId: 'original-project', projectName: 'Original project',
          url: browserAccess === 'local' ? `http://127.0.0.1:31002/browser/${'a'.repeat(32)}/`
            : `http://127.0.0.1:31002/#${'b'.repeat(64)}` }
      } })
    const listed = await mcp.handle({ id: 1, method: 'tools/list' })
    const tool = listed.result.tools.find(item => item.name === 'yugoo_workbuddy_open_panel')
    assert.match(tool.description, /Workers remain unsupported/)
    assert.match(tool.description, /GRA is conditional on current-service native background readiness/)
    assert.match(tool.description, /design_status\.hostCapabilities and backgroundReviewProtocol/)
    assert.match(tool.description, /attached Agent result is not background execution/)
    assert.doesNotMatch(tool.description, /Workers\/GRA remain unavailable/)
    assert.equal(starts.length, 0, 'describing the tool starts neither a service nor a readiness probe')

    const args = { projectRoot: '/original/project', sessionId, nativeCwd: '/original/native',
      transcriptPath: '/original/session.jsonl', view }
    const opened = await mcp.handle({ id: 2, method: 'tools/call',
      params: { name: tool.name, arguments: args } })
    assert.notEqual(opened.result.isError, true)
    const result = JSON.parse(opened.result.content[0].text)
    assert.equal(result.connection, '/owned/state/connections/exact.json')
    assert.match(result.instruction, /Workers 仍不可用/)
    assert.match(result.instruction, /GRA 须遵循 design_status\.hostCapabilities 和 backgroundReviewProtocol/)
    assert.match(result.instruction, /仅当前服务已验证 ready 且 backgroundReviews=true/)
    assert.match(result.instruction, /真实后台回执启动与绑定/)
    assert.match(result.instruction, /未就绪时请求保持 pending/)
    assert.match(result.instruction, /attached 返回不是后台执行/)
    assert.doesNotMatch(result.instruction, /Workers\/GRA 仍不可用/)
    assert.equal(result.hostCapabilities, undefined, 'opening a page does not claim readiness')
    assert.equal(starts.length, 1)
    assert.equal(starts[0].workbuddyProducer, true, 'serial Producer capability is preserved independently')

    const denied = await mcp.handle({ id: 3, method: 'tools/call',
      params: { name: tool.name, arguments: { ...args, backgroundReviews: true } } })
    assert.equal(denied.result.isError, true)
    assert.equal(starts.length, 1, 'a caller cannot enable background execution through open-panel arguments')
    const invalid = await mcp.handle({ id: 4, method: 'tools/call',
      params: { name: tool.name, arguments: { ...args, sessionId: 'not-a-native-session' } } })
    assert.equal(invalid.result.isError, true)
    assert.equal(starts.length, 1, 'conditional guidance preserves exact native identity checks')
  }
})

test('WorkBuddy probe stages native manifest/MCP/Bash hooks without Qwen protocol or host launcher', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workbuddy-package-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'probe'), options = { nodeExecutable: "C:\\Test's tools\\node.exe", runtimeRoot: 'C:\\Shared runtime' }
  await packageWorkBuddyProbe(target, options)
  const read = async path => JSON.parse(await readFile(join(target, path), 'utf8'))
  assert.equal((await read('.codebuddy-plugin/plugin.json')).name, 'yugoo-design')
  const guide = await readFile(join(target, 'README.md'), 'utf8')
  assert.match(guide, /install --host workbuddy/)
  assert.match(guide, /--suite-version 0\.3\.30/)
  assert.match(guide, /nativeImport\.market/)
  assert.doesNotMatch(guide, /yugoo-workbuddy-test|yugoo-workbuddy-probe|one-time rename/)
  assert.match(await readFile(join(target, 'skills/yugoo/SKILL.md'), 'utf8'), /^---\nname: yugoo\n/)
  const installedMethod = await readFile(join(target, 'skills/yugoo/SKILL.md'), 'utf8')
  assert.match(installedMethod, /\[native execution reference\]\(native-execution\.md\)/)
  for (const operation of ['design_main_context', 'report_design_clarity', 'backgroundReviewReadiness', 'design_bind_reviews', 'design_submit_review']) assert.ok(installedMethod.includes(operation), operation)
  assert.match(installedMethod, /Workers\/nested delegation remain unavailable/)
  assert.doesNotMatch(installedMethod, /Workers\/nested delegation and GRA are unavailable|background GRA, which remain disabled/)
  const installedReference = await readFile(join(target, 'skills/yugoo/native-execution.md'), 'utf8')
  assert.equal(installedReference, await readFile(new URL('../plugin/design-system/skills/design-panel/native-execution.md', import.meta.url), 'utf8'))
  assert.match(installedReference, /Only ready permits review dispatch|must be `ready`/)
  assert.match(installedReference, /synchronously/)
  await assert.rejects(readFile(join(target, 'skills/design/SKILL.md')), { code: 'ENOENT' })
  const mcp = (await read('.mcp.json')).mcpServers['design-system-workbuddy-probe']
  assert.deepEqual(mcp, { command: options.nodeExecutable, args: ['C:\\Shared runtime\\scripts\\design.mjs', 'mcp'] })
  const hooks = (await read('hooks/hooks.json')).hooks
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'PostToolUse'])
  for (const group of Object.values(hooks)) {
    const hook = group[0].hooks[0]
    assert.equal(hook.command, "'C:/Test'\\''s tools/node.exe' \"${CODEBUDDY_PLUGIN_ROOT}/scripts/workbuddy-context-probe.mjs\"")
    assert.equal(hook.asyncRewake, undefined)
    assert.equal(hook.shell, undefined)
  }
  await assert.rejects(packageWorkBuddyProbe(target, options), { code: 'EEXIST' })
  await assert.rejects(packageWorkBuddyProbe(join(root, 'bad'), { ...options, runtimeRoot: 'relative' }))
})

test('identity probe is bounded, discards tool content, and never grants binding authority', () => {
  const event = { hook_event_name: 'PostToolUse', session_id: 'native-123', cwd: 'C:\\project', transcript_path: 'C:\\session.jsonl', tool_response: 'secret-sentinel' }
  const result = workBuddyProbeContext(event)
  assert.match(result.hookSpecificOutput.additionalContext, /YUGOO_WORKBUDDY_IDENTITY_PROBE/)
  assert.match(result.hookSpecificOutput.additionalContext, /not authorization/)
  assert.doesNotMatch(JSON.stringify(result), /secret-sentinel/)
  assert.throws(() => workBuddyProbeContext({ ...event, session_id: '' }))
  assert.throws(() => workBuddyProbeContext({ ...event, cwd: 'a\nb' }))
  assert.equal(workBuddyProbeContext({ ...event, hook_event_name: 'FileChanged' }), undefined)
})

test('local marketplace resolves its plugin and refuses existing output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workbuddy-marketplace-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'market'), options = { nodeExecutable: 'C:\\runtime\\node.exe', runtimeRoot: 'C:\\shared' }
  await packageWorkBuddyProbeMarketplace(target, options)
  const market = JSON.parse(await readFile(join(target, '.codebuddy-plugin/marketplace.json'), 'utf8'))
  assert.equal(market.name, 'yugoo-design')
  assert.equal(market.plugins.length, 1)
  assert.match(market.plugins[0].description, /current-service native background readiness/)
  assert.doesNotMatch(market.plugins[0].description, /GRA remain unavailable/)
  const plugin = JSON.parse(await readFile(join(target, market.plugins[0].source, '.codebuddy-plugin/plugin.json'), 'utf8'))
  assert.equal(plugin.name, market.plugins[0].name)
  assert.equal(plugin.version, market.plugins[0].version)
  await assert.rejects(packageWorkBuddyProbeMarketplace(target, options), { code: 'EEXIST' })
})

test('separate desktop imports contain a Skill and MCP JSON, not a silently installed plugin or Hook', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workbuddy-imports-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'imports')
  await packageWorkBuddySkillConnector(target, { nodeExecutable: 'C:\\runtime\\node.exe', runtimeRoot: 'C:\\shared' })
  assert.deepEqual((await readdir(target)).sort(), ['design-system-readiness', 'mcp.json'])
  const skill = await readFile(join(target, 'design-system-readiness/SKILL.md'), 'utf8')
  for (const field of ['description:', 'description_zh:', 'description_en:', 'version:', 'author:']) assert.ok(skill.includes(field))
  assert.match(skill, /do not install Hooks/)
  assert.deepEqual(JSON.parse(await readFile(join(target, 'mcp.json'), 'utf8')).mcpServers['design-system-workbuddy-probe'].args, ['C:\\shared\\scripts\\design.mjs', 'mcp'])
})

test('one versioned suite preserves original MCP/hooks and includes both UI probes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workbuddy-unified-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'market')
  await packageWorkBuddyProbeMarketplace(target, { nodeExecutable: 'C:\\runtime\\node.exe', runtimeRoot: 'C:\\shared' })
  const market = JSON.parse(await readFile(join(target, '.codebuddy-plugin/marketplace.json'), 'utf8'))
  assert.equal(market.name, 'yugoo-design')
  assert.equal(market.plugins[0].name, 'yugoo-design')
  assert.equal(market.plugins[0].version, '0.3.30')
  assert.equal(market.plugins[0].source, './plugins/yugoo-design-0.3.30')
  const plugin = join(target, market.plugins[0].source)
  const mcp = JSON.parse(await readFile(join(plugin, '.mcp.json'), 'utf8')).mcpServers
  assert.deepEqual(Object.keys(mcp).sort(), ['design-system-workbuddy-probe', 'design-system-workbuddy-ui'])
  assert.equal(mcp['design-system-workbuddy-ui'].args[0], '${CODEBUDDY_PLUGIN_ROOT}/scripts/workbuddy-ui-probes.mjs')
  const { pathToFileURL } = await import('node:url')
  const { createWorkBuddyUiProbes } = await import(pathToFileURL(join(plugin, 'scripts/workbuddy-ui-probes.mjs')))
  const probes = createWorkBuddyUiProbes(); t.after(() => probes.close())
  const list = await probes.handle({ id: 1, method: 'tools/list' })
  assert.deepEqual(list.result.tools.map(x => x.name), ['yugoo_workbuddy_message_probe', 'yugoo_workbuddy_relay_probe', 'yugoo_workbuddy_open_panel'])
  const resources = await probes.handle({ id: 2, method: 'resources/list' })
  assert.deepEqual(resources.result.resources.map(x => x.uri), list.result.tools.map(x => x._meta.ui.resourceUri))
  assert.equal((await probes.handle({ id: 3, method: 'tools/call', params: { name: 'design_command' } })).error.code, -32602)
})


test('browser access package policy validates before creating output and defaults explicitly to local', async t => {
 const root=await mkdtemp(join(tmpdir(),'workbuddy-policy-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const options={nodeExecutable:'C:\\runtime\\node.exe',runtimeRoot:'C:\\shared'}
 for(const browserAccess of [false,null,'off']){
  const target=join(root,'invalid')
  await assert.rejects(packageWorkBuddyProbeMarketplace(target,{...options,browserAccess}),/browserAccess/)
  await assert.rejects(readdir(target),{code:'ENOENT'})
 }
 for(const browserAccess of [undefined,'local','token']){
  const target=join(root,browserAccess??'default')
  await packageWorkBuddyProbe(target,{...options,browserAccess})
  const config=JSON.parse(await readFile(join(target,'scripts/workbuddy-package-runtime.json'),'utf8'))
  assert.equal(config.browserAccess,browserAccess??'local')
 }
})
