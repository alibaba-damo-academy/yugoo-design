import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDshDesignDelegation, WORKER_DENIED_PRODUCER_TOOLS } from '../src/dsh-producer-delegation.ts'
import { createDesignArtifactAttemptRegistry } from '../src/artifact-attempt-registry.ts'
import { startDesignFileWorker } from '../src/dsh-file-worker-agent.ts'
import { designSkillResourceEntryPaths } from '../src/reconstruction-prompt.ts'
import { registerDshProducerDesignTools } from '../src/dsh-producer-design-tools.ts'

test('file Worker forbids every legacy denied authority before any parent lookup or child creation', async () => {
  for (const name of [...WORKER_DENIED_PRODUCER_TOOLS, 'run_code', 'run_skill_script',
    'design_worker_read_artifact', 'design_worker_write_artifact', 'design_worker_edit_artifact']) {
    let lookups = 0
    await assert.rejects(startDesignFileWorker({
      parent: { ctx: { tools: { get: () => { lookups++; throw new Error('unexpected parent lookup') } } } },
      signal: new AbortController().signal, label: 'forbidden capability probe',
      prompt: [], maxDepth: 3, inheritedToolNames: [name], installWorkerTools: () => {},
    }), /forbidden inherited authority/)
    assert.equal(lookups, 0, name)
  }
})

for (const priorContent of [undefined, 'Existing user-owned findings must survive an unsuccessful replacement.']) {
test(`a no-result Worker leaves no success receipt with ${priorContent === undefined ? 'a new' : 'an existing'} artifact`, async () => {
  const tools = new Map(), files = new Map(), events = [], prompts = new Map()
  if (priorContent !== undefined) files.set('sample/unavailable.md', { encoding: 'utf8', content: priorContent })
  let starts = 0, disposals = 0
  const signal = new AbortController().signal
  const delegation = createDshDesignDelegation({
    skillName: 'sample', provider: 'dsh-design-file-worker', maxDepth: 3,
    attempts: createDesignArtifactAttemptRegistry(),
    workspace: {
      read: async path => files.get(path),
      write: async (path, file) => { files.set(path, file) },
      edit: async () => { throw new Error('unused') },
    },
    recordAttempt: event => events.push(event),
    startSubagent: async () => { throw new Error('legacy route used') },
    startFileWorker: async request => {
      starts++
      const prompt = request.prompt[0].text
      const assignment = JSON.parse(prompt.match(/<delegation_artifact>\n([^\n]+)/)[1])
      prompts.set(assignment.artifact_id, prompt)
      const child = { session: { id: `worker-${assignment.artifact_id}` } }, childTools = new Map()
      request.installWorkerTools({ tools: { register: tool => childTools.set(tool.name, tool) } }, child)
      const result = (async () => {
        if (assignment.artifact_id === 'usable') {
          await childTools.get('design_worker_write_artifact').execute({
            assignment_id: prompt.match(/assignment_id "([^"]+)"/)[1],
            content: 'An available source supports this result.',
          }, { agent: child, signal })
        }
        // A normal Native turn ending is not evidence that an artifact exists.
        return { stopReason: 'completed', output: assignment.artifact_id === 'unavailable'
          ? [{ type: 'text', text: 'No usable source after bounded retrieval; no findings were produced.' }] : [],
          ...(assignment.artifact_id === 'unavailable' ? { diagnostic: 'Authorized source returned HTTP 404.' } : {}) }
      })()
      return { id: child.session.id, localAgent: child, result, dispose: async () => { disposals++ } }
    },
  })
  delegation.install({ tools: { register: tool => tools.set(tool.name, tool) } })
  const args = { batch_id: 'bounded-source-check', items: [
    { artifact_kind: 'source_report', artifact_id: 'usable', artifact_file: 'sample/usable.md', prompt: 'Write the supported result.' },
    { artifact_kind: 'source_report', artifact_id: 'unavailable', artifact_file: 'sample/unavailable.md',
      prompt: 'No usable evidence is available; leave the finding absent rather than create a diagnostic report.' },
  ] }
  const result = await tools.get('design_delegate_frontier').execute(args, { agent: { session: { id: 'producer' } }, signal })
  assert.deepEqual(result.items.map(item => item.status), ['completed', 'failed'])
  assert.equal(result.items[0].artifact.path, 'sample/usable.md')
  assert.equal(Object.hasOwn(result.items[1], 'artifact'), false)
  assert.match(result.items[1].diagnostic, /completed without writing "sample\/unavailable.md"/)
  assert.match(result.items[1].diagnostic, /Authorized source returned HTTP 404/)
  assert.match(result.items[1].diagnostic, /No usable source after bounded retrieval; no findings were produced/)
  assert.equal(files.get('sample/unavailable.md')?.content, priorContent, 'failure leaves the original artifact intact without adding diagnostics')
  assert.deepEqual(events.filter(event => event.phase === 'completed').map(event => event.artifactId), ['usable'])
  assert.equal(events.find(event => event.artifactId === 'unavailable' && event.phase === 'failed').receipt, undefined)
  assert.deepEqual(await tools.get('design_delegate_frontier').execute(args, { agent: { session: { id: 'producer' } }, signal }), result)
  assert.equal(starts, 2, 'replaying the settled frontier never retries the failed Worker')
  assert.equal(disposals, 2)
  const prompt = prompts.get('unavailable')
  assert.doesNotMatch(prompt, /Finish only after the complete artifact is on disk/)
  assert.match(prompt, /leave the assigned artifact unwritten/)
  assert.match(prompt, /diagnostic-only artifact/)
})
}

for (const method of ['write', 'edit', 'script', 'rejected-write', 'unmatched-edit', 'diagnostic-script']) {
test(`an existing artifact needs a successful current-attempt output through ${method}`, async () => {
  const tools = new Map(), events = [], signal = new AbortController().signal
  const original = { encoding: 'utf8', content: 'Previously accepted content.' }
  let file = original
  const delegation = createDshDesignDelegation({
    skillName: 'sample', provider: 'dsh-design-file-worker', maxDepth: 3,
    attempts: createDesignArtifactAttemptRegistry(),
    workspace: {
      read: async () => file,
      write: async (_path, value) => {
        if (method === 'rejected-write') throw new Error('Write rejected before changing the file.')
        file = value
      },
      edit: async () => ({ replacements: method === 'unmatched-edit' ? 0 : 1 }),
    },
    scripts: { run: async () => ({ exitCode: 0, stdout: original.content, stderr: '' }) },
    recordAttempt: event => events.push(event),
    startSubagent: async () => { throw new Error('legacy route used') },
    startFileWorker: async request => {
      const child = { session: { id: 'worker' } }, childTools = new Map()
      request.installWorkerTools({ tools: { register: tool => childTools.set(tool.name, tool) } }, child)
      const assignment_id = request.prompt[0].text.match(/assignment_id "([^"]+)"/)[1]
      const result = (async () => {
        const exec = { agent: child, signal }
        if (method === 'write' || method === 'rejected-write') {
          const write = childTools.get('design_worker_write_artifact').execute({ assignment_id, content: original.content }, exec)
          if (method === 'rejected-write') await assert.rejects(write, /Write rejected/)
          else await write
        } else if (method === 'edit' || method === 'unmatched-edit') {
          await childTools.get('design_worker_edit_artifact').execute({ assignment_id, old_text: 'accepted', new_text: 'accepted' }, exec)
        } else {
          await childTools.get('run_skill_script').execute({ path: 'render.mjs', input_json: {},
            ...(method === 'script' ? { output_file: 'sample/existing.md' } : {}) }, exec)
        }
        return { stopReason: 'completed', output: [{ type: 'text', text: 'Bounded attempt finished.' }] }
      })()
      return { id: 'worker', localAgent: child, result, dispose: async () => {} }
    },
  })
  delegation.install({ tools: { register: tool => tools.set(tool.name, tool) } })
  const result = await tools.get('design_delegate_frontier').execute({ batch_id: method, items: [{
    artifact_kind: 'report', artifact_id: 'existing', artifact_file: 'sample/existing.md', prompt: 'Validate and replace the assigned report if supported.',
  }] }, { agent: { session: { id: 'producer' } }, signal })
  const successful = ['write', 'edit', 'script'].includes(method)
  assert.equal(result.items[0].status, successful ? 'completed' : 'failed')
  assert.equal(Object.hasOwn(result.items[0], 'artifact'), successful)
  assert.equal(events.some(event => event.phase === 'completed'), successful)
  assert.equal(file.content, original.content, 'same-byte writes succeed; unsuccessful operations preserve the old artifact')
})
}

test('plugin Worker receives its own artifact and script tools, with exact output ownership', async () => {
  const parentTools = new Map()
  const childTools = []
  const files = new Map()
  const events = []
  let legacyStarts = 0
  let revokedArtifactChecks = 0
  let retainedArtifact
  let claimAttempt
  const scriptInputs = []
  const attempts = createDesignArtifactAttemptRegistry()
  const signal = new AbortController().signal
  const producer = { session: { id: 'producer' } }
  const delegation = createDshDesignDelegation({
    skillName: 'page_design', provider: 'dsh-design-file-worker', maxDepth: 3,
    workerEvidenceTools: ['web_search', 'read_skill_resource'],
    workerResourcePaths: designSkillResourceEntryPaths('page_design', {
      'page_design/reference/artifact-contract.md': 'Exact installed contract body, read on demand.',
      'page_design/reference/large-catalog.yaml': 'Unneeded catalog.',
      'other_bundle/reference/artifact-contract.md': 'Unrelated Bundle contract.',
    }),
    startSubagent: async () => { legacyStarts++; throw new Error('legacy route used') },
    startFileWorker: async request => {
      assert.deepEqual(request.inheritedToolNames, ['web_search', 'read_skill_resource'])
      const prompt = request.prompt[0].text
      assert.deepEqual(JSON.parse(prompt.match(/<bundle_resources>\s*([^<]+)<\/bundle_resources>/)[1]),
        ['reference/artifact-contract.md'])
      assert.ok(prompt.includes('read_skill_resource using these current-Bundle relative paths'))
      assert.ok(!prompt.includes('Exact installed contract body'))
      assert.ok(!prompt.includes('large-catalog.yaml'))
      assert.ok(!prompt.includes('other_bundle/'))
      assert.equal(request.toolFilter, undefined)
      assert.equal(request.agentOptions, undefined)
      const tools = new Map()
      const child = { session: { id: `worker-${childTools.length}` } }
      childTools.push(tools)
      await request.installWorkerTools({ tools: { register: definition => tools.set(definition.name, definition) } }, child)
      const assignment = request.prompt[0].text.match(/assignment_id "([^"]+)"/)[1]
      const output = JSON.parse(request.prompt[0].text.match(/<delegation_artifact>\n([^\n]+)/)[1]).artifact_file
      const exec = { agent: child, signal }
      retainedArtifact = () => tools.get('design_worker_write_artifact').execute({
        assignment_id: assignment, content: 'late output',
      }, exec)
      const result = (async () => {
        await assert.rejects(tools.get('run_skill_script').execute({
          path: 'render.mjs', input_json: {}, output_file: 'page_design/other.html',
        }, exec), /assigned artifact/)
        await tools.get('run_skill_script').execute({ path: 'render.mjs', input_json: {}, output_file: output }, exec)
        await tools.get('run_skill_script').execute({ path: 'render.mjs', input_file: output,
          input_context: { artifact_id: 'a', script_io: { input_file: 'forged', output_file: null } }, output_file: output }, exec)
        const read = await tools.get('design_worker_read_artifact').execute({ assignment_id: assignment }, exec)
        assert.equal(read.content, '<html>rendered</html>')
        return { stopReason: 'completed', output: [] }
      })()
      return { id: child.session.id, localAgent: child, result, dispose: async () => {
        // Settlement has removed the live assignment, but the outer caller has
        // not yet retired its file claim. A retained capability must still fail.
        assert.equal(attempts.isActive('a', claimAttempt), true)
        assert.equal(attempts.isActive('path:page_design/a.html', claimAttempt), true)
        for (const name of ['design_worker_read_artifact', 'design_worker_write_artifact', 'design_worker_edit_artifact']) {
          await assert.rejects(tools.get(name).execute({
            assignment_id: assignment, content: 'late output', old_text: 'rendered', new_text: 'late',
          }, exec), /no longer active/)
        }
        revokedArtifactChecks++
      } }
    },
    attempts: { ...attempts, claimAll: (ids, attempt, owner) => {
      claimAttempt = attempt
      attempts.claimAll(ids, attempt, owner)
    } },
    workspace: {
      read: async path => files.get(path),
      write: async (path, file) => { files.set(path, file) },
      edit: async () => { throw new Error('unused') },
    },
    scripts: { run: async (_path, _args, input) => {
      scriptInputs.push(input)
      return { exitCode: 0, stdout: '<html>rendered</html>', stderr: '' }
    } },
    recordAttempt: event => events.push(event),
  })
  delegation.install({ tools: { register: definition => parentTools.set(definition.name, definition) } })
  assert.deepEqual([...parentTools.keys()].sort(), ['design_delegate', 'design_delegate_frontier'])
  const receipt = await parentTools.get('design_delegate').execute({
    artifact_kind: 'page_html', artifact_id: 'a', artifact_file: 'page_design/a.html', prompt: 'Create page',
  }, { agent: producer, signal })
  assert.equal(receipt.artifact.path, 'page_design/a.html')
  assert.equal(legacyStarts, 0)
  assert.equal(files.has('page_design/other.html'), false)
  assert.equal(events.at(-1).phase, 'completed')
  assert.equal(revokedArtifactChecks, 1)
  assert.equal(files.get('page_design/a.html').content, '<html>rendered</html>')
  assert.deepEqual(scriptInputs, ['{}',
    '{"artifact_id":"a","script_io":{"input_file":"page_design/a.html","output_file":"page_design/a.html"}}\n<html>rendered</html>'])
  await assert.rejects(retainedArtifact(), /no longer active/)
  const workerTools = childTools[0]
  await assert.rejects(workerTools.get('run_skill_script').execute({
    path: 'render.mjs', input_json: {}, output_file: 'page_design/a.html',
  }, { signal }), /no longer active/)
})

test('serial focus blocks single/frontier admission with owner and recovery, without losing serial work', async () => {
  const attempts = createDesignArtifactAttemptRegistry()
  const tools = new Map(), files = new Map(), events = []
  const ctx = { tools: { register: tool => tools.set(tool.name, tool) } }
  let starts = 0, publications = 0, conclusions = 0
  const exec = { agent: { session: { id: 'producer-current' } }, signal: new AbortController().signal,
    concludeTurn() { conclusions++ } }
  const workspace = {
    read: async path => files.get(path),
    write: async (path, file) => { files.set(path, file) },
    validate: async () => [],
    publish: async () => { publications++; return { kind: 'published', stateRevision: 'committed', diff: '' } },
  }
  // The activity port has the same invocation-local serial ownership as the
  // execution plugin; this tests tool admission/recovery, not a native Host.
  registerDshProducerDesignTools(ctx, workspace, { read: async () => undefined }, 'none', {
    focus(_kind, id, path) {
      attempts.claimAll([id, `path:${path}`], 'serial-attempt', { role: 'producer', sessionId: exec.agent.session.id })
      return id
    },
    observeTool() {},
  })
  const delegation = createDshDesignDelegation({
    skillName: 'flow_design', provider: 'local-worker', maxDepth: 2,
    attempts, workspace, recordAttempt: event => events.push(event),
    startSubagent: async () => { starts++; throw new Error('must not start') },
  })
  delegation.install(ctx)
  const target = { artifact_kind: 'flow_bpmn', artifact_id: 'P-001', artifact_file: 'flow_design/P-001.bpmn' }
  await tools.get('design_focus_artifact').execute(target, exec)
  await tools.get('write').execute({ path: target.artifact_file, content: 'existing serial draft' }, exec)
  const rejected = error => {
    assert.match(error.message, /active attempt in this invocation: serial Producer focus/)
    assert.match(error.message, /serial-attempt/)
    assert.match(error.message, /producer-current/)
    assert.match(error.message, /Continue the already focused artifact serially with the scoped Design file tools/)
    assert.match(error.message, /Repeating delegation cannot release the focus/)
    return true
  }
  for (let retry = 0; retry < 2; retry++) {
    await assert.rejects(tools.get('design_delegate').execute({ ...target, prompt: 'Repair the artifact' }, exec), rejected)
  }
  await assert.rejects(tools.get('design_delegate_frontier').execute({ batch_id: 'frontier', items: [
    { artifact_kind: 'flow_bpmn', artifact_id: 'P-002', artifact_file: 'flow_design/P-002.bpmn', prompt: 'Independent task' },
    { ...target, prompt: 'Repair the artifact' },
  ] }, exec), rejected)
  assert.equal(starts, 0)
  assert.deepEqual(events, [], 'rejected admission cannot become Worker execution evidence')
  assert.deepEqual(delegation.settlementDiagnostics(), [])
  assert.equal(files.get(target.artifact_file).content, 'existing serial draft')
  assert.equal(attempts.isActive(target.artifact_id, 'serial-attempt'), true)
  assert.equal(attempts.isActive(`path:${target.artifact_file}`, 'serial-attempt'), true)
  attempts.claimAll(['P-002', 'path:flow_design/P-002.bpmn'], 'independent-attempt')
  assert.equal(attempts.isActive('P-002', 'independent-attempt'), true, 'failed frontier claims nothing partially')
  // Follow the diagnostic through the existing tools, without retiring any claim.
  await tools.get('write').execute({ path: target.artifact_file, content: 'completed serial artifact' }, exec)
  const validation = await tools.get('design_validate').execute({ outcome: 'complete' }, exec)
  assert.equal(validation.valid, true)
  const publication = await tools.get('design_publish').execute({ action: 'complete' }, exec)
  assert.equal(publication.kind, 'published')
  assert.equal(publications, 1)
  assert.equal(conclusions, 1)
  assert.equal(files.get(target.artifact_file).content, 'completed serial artifact')
})

for (const stopReason of ['completed', 'error']) test(`Worker ownership guards ID and file until ${stopReason} settlement, then permits retry`, async () => {
  const attempts = createDesignArtifactAttemptRegistry()
  const tools = new Map(), files = new Map()
  const exec = { agent: { session: { id: 'requesting-producer' } }, signal: new AbortController().signal }
  let release, started, starts = 0
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { started = resolve })
  const target = { artifact_kind: 'page_html', artifact_id: 'A', artifact_file: 'page_design/A.html', prompt: 'Write A' }
  const delegation = createDshDesignDelegation({
    skillName: 'page_design', provider: 'local-worker', maxDepth: 2,
    attempts, workspace: {
      read: async path => files.get(path),
      write: async (path, file) => { files.set(path, file) },
    }, recordAttempt() {},
    startSubagent: async (_provider, request) => {
      starts++
      const child = { session: { id: `worker-${starts}` } }
      const assignment = request.prompt[0].text.match(/assignment_id "([^"]+)"/)[1]
      return { id: child.session.id, localAgent: child, dispose: async () => {}, result: (async () => {
        started()
        await gate
        await tools.get('design_worker_write_artifact').execute({ assignment_id: assignment, content: '<html>A</html>' }, { ...exec, agent: child })
        return { stopReason: starts === 1 ? stopReason : 'completed', output: [] }
      })() }
    },
  })
  delegation.install({ tools: { register: tool => tools.set(tool.name, tool) } })
  const pending = tools.get('design_delegate').execute(target, exec)
  const settled = stopReason === 'completed' ? pending : assert.rejects(pending, /ended with error/)
  await ready
  const rejected = error => {
    assert.match(error.message, /Worker delegation/)
    assert.match(error.message, /requested by session "requesting-producer"/)
    assert.match(error.message, /Wait for that foreground delegation to settle/)
    return true
  }
  await assert.rejects(tools.get('design_delegate').execute({ ...target, artifact_file: 'page_design/alias.html' }, exec), rejected)
  await assert.rejects(tools.get('design_delegate').execute({ ...target, artifact_id: 'alias' }, exec), rejected)
  assert.throws(() => attempts.claimAll(['A', 'path:page_design/A.html'], 'serial-takeover', { role: 'producer', sessionId: 'requesting-producer' }), rejected)
  await assert.rejects(tools.get('design_delegate_frontier').execute({ batch_id: 'conflict', items: [
    { ...target, artifact_id: 'B', artifact_file: 'page_design/B.html' },
    { ...target, artifact_id: 'alias' },
  ] }, exec), rejected)
  assert.equal(starts, 1)
  assert.equal(delegation.settlementDiagnostics().length, 1)
  release()
  await settled
  assert.deepEqual(delegation.settlementDiagnostics(), [])
  const retry = await tools.get('design_delegate').execute(target, exec)
  assert.equal(retry.artifact.path, target.artifact_file)
  assert.equal(starts, 2)
  assert.equal(files.has('page_design/alias.html'), false)
  attempts.claimAll(['B', 'path:page_design/B.html'], 'unclaimed-frontier-item')
})
