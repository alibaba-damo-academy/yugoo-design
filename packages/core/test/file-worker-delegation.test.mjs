import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDshDesignDelegation, WORKER_DENIED_PRODUCER_TOOLS } from '../src/dsh-producer-delegation.ts'
import { createDesignArtifactAttemptRegistry } from '../src/artifact-attempt-registry.ts'
import { startDesignFileWorker } from '../src/dsh-file-worker-agent.ts'

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

test('plugin Worker receives its own artifact and script tools, with exact output ownership', async () => {
  const parentTools = new Map()
  const childTools = []
  const files = new Map()
  const events = []
  let legacyStarts = 0
  let revokedArtifactChecks = 0
  let retainedArtifact
  let claimAttempt
  const attempts = createDesignArtifactAttemptRegistry()
  const signal = new AbortController().signal
  const producer = { session: { id: 'producer' } }
  const delegation = createDshDesignDelegation({
    skillName: 'page_design', provider: 'dsh-design-file-worker', maxDepth: 3,
    workerEvidenceTools: ['web_search'],
    startSubagent: async () => { legacyStarts++; throw new Error('legacy route used') },
    startFileWorker: async request => {
      assert.deepEqual(request.inheritedToolNames, ['web_search'])
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
    attempts: { ...attempts, claimAll: (ids, attempt) => {
      claimAttempt = attempt
      attempts.claimAll(ids, attempt)
    } },
    workspace: {
      read: async path => files.get(path),
      write: async (path, file) => { files.set(path, file) },
      edit: async () => { throw new Error('unused') },
    },
    scripts: { run: async () => ({ exitCode: 0, stdout: '<html>rendered</html>', stderr: '' }) },
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
  await assert.rejects(retainedArtifact(), /no longer active/)
  const workerTools = childTools[0]
  await assert.rejects(workerTools.get('run_skill_script').execute({
    path: 'render.mjs', input_json: {}, output_file: 'page_design/a.html',
  }, { signal }), /no longer active/)
})
