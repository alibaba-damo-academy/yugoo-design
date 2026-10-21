import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository, Signature } from 'yugoo-design-git-native'
import DesignService from '../src/design-service.ts'
import { registerDesignGitReadTool } from '../src/dsh-git-read-tool.ts'
import { executeNativeGit } from '../src/git-native.ts'
import { nativeGitOperation } from '../src/git-native-operation.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'design-agent-git-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repo = Repository.init(root)
  const text = '😀中文\n'.repeat(6000), commits = []
  for (const content of ['first version\n', text]) {
    const tree = repo.treebuilder(), signature = new Signature('Read fixture', 'fixture@invalid', new Date(1700000000000 + commits.length * 1000))
    tree.insert('facts.txt', repo.blob(Buffer.from(content)), 0o100644)
    commits.push(repo.commit('HEAD', signature, signature, `version ${commits.length}\n\nFull commit details.\n`, repo.findTree(tree.write()), commits.slice(-1)))
  }
  repo.free()
  const project = { projectId: 'fixture-project', root }
  const parent = { session: { header: {} }, ctx: { agents: { get: () => undefined } } }
  const child = { session: { header: { parentSession: 'parent' } }, ctx: { agents: { get: id => id === 'parent' ? parent : undefined } } }
  const calls = [], mutations = [], state = { revision: 1, afterRead: undefined }
  const spawn = Object.assign(async () => assert.fail('Agent Git read must not spawn system Git'), {
    native: async request => {
      calls.push(request.operation.kind)
      if (['init', 'publish', 'capture'].includes(request.operation.kind)) mutations.push(request.operation.kind)
      const result = await executeNativeGit(request.cwd, nativeGitOperation(request.operation), request.signal)
      await state.afterRead?.(request.operation)
      return result
    },
  })
  const receiver = {
    selectedProjectForAgent: async owner => owner === parent ? project : undefined,
    selectionForAgent: () => ({ projectId: project.projectId, revision: state.revision }),
    assertProjectSelection: (owner, id, revision) => {
      assert.equal(owner, parent); assert.equal(id, project.projectId)
      if (revision !== state.revision) throw new Error('selection changed')
    },
    spawnAdapter: () => spawn,
    projects: { require: async () => project, status: async () => ({ lastCheckpoint: commits[1], porcelain: '' }) },
  }
  const run = (caller, args, signal) => DesignService.prototype.queryDesignGit.call(receiver, caller, args, signal)
  let tool
  registerDesignGitReadTool({ tools: { register: value => { tool = value } } }, { queryDesignGit: run })
  return { parent, child, project, commits, calls, mutations, state, receiver, run, tool, text }
}

test('registered native read tool preserves complete historical text, diff, log and messages without spawning Git', async t => {
  const f = await fixture(t)
  assert.equal(f.tool.name, 'design_git_read')
  assert.equal(f.tool.parameters.properties.root, undefined)
  assert.equal(f.tool.parameters.properties.argv, undefined)
  assert.deepEqual(f.tool.parameters.properties.action.enum, ['status', 'history', 'message', 'diff', 'list', 'read'])
  const pins = { project: f.project.projectId, checkpoint: f.commits[1] }
  const invoke = async args => JSON.parse((await f.tool.execute({ ...pins, ...args }, { agent: f.child })).content)
  let offset = 0, text = ''
  do {
    const page = await invoke({ action: 'read', path: 'facts.txt', offset })
    text += page.text
    if (page.page.complete) break
    offset = page.page.nextOffset
  } while (text.length <= f.text.length)
  assert.equal(text, f.text)
  assert.equal((await invoke({ action: 'read', path: 'facts.txt', checkpoint: f.commits[0] })).text, 'first version\n')
  const history = await invoke({ action: 'history', limit: 1 })
  assert.equal(history.entries[0].commit, f.commits[1]); assert.equal(history.page.nextOffset, 1)
  const older = await invoke({ action: 'history', limit: 1, offset: 1 })
  assert.equal(older.entries[0].commit, f.commits[0]); assert.equal(older.page.complete, true)
  assert.match((await invoke({ action: 'message' })).text, /Full commit details/)
  assert.deepEqual((await invoke({ action: 'list' })).entries.map(entry => entry.path), ['facts.txt'])
  offset = 0; let diff = ''
  do {
    const page = await invoke({ action: 'diff', from: f.commits[0], path: 'facts.txt', offset })
    diff += page.text
    if (page.page.complete) break
    offset = page.page.nextOffset
  } while (diff.length < 200000)
  assert.match(diff, /-first version/); assert.equal((diff.match(/\+😀中文/gu) ?? []).length, 6000)
  assert.equal((await invoke({ action: 'status' })).live, true)
  assert.deepEqual(f.mutations, [])
  assert.ok(f.calls.includes('history'))
})

test('native child requires project/checkpoint pins and cannot select another repository', async t => {
  const f = await fixture(t)
  await assert.rejects(f.run(f.child, { action: 'history' }), /exact project/)
  await assert.rejects(f.run(f.child, { action: 'history', project: 'other', checkpoint: f.commits[1] }), /binding/)
  await assert.rejects(f.run(f.parent, { action: 'history', root: '/other' }), /Unsupported/)
  await assert.rejects(f.tool.execute({ action: 'history' }, {}), /calling Agent/)
  assert.deepEqual(f.calls, [])
})

test('unbound and cyclic native ancestry cannot fall back to a project', async t => {
  const f = await fixture(t), args = { action: 'history', project: f.project.projectId, checkpoint: f.commits[1] }
  f.receiver.selectedProjectForAgent = async () => undefined
  await assert.rejects(f.run(f.child, args), /No selected/)
  f.child.ctx.agents.get = () => f.child
  await assert.rejects(f.run(f.child, args), /Cyclic/)
  assert.deepEqual(f.calls, [])
})

test('late read result is rejected after project selection changes, cancellation or repository removal', async t => {
  for (const variant of ['selection', 'cancel', 'removed']) {
    const f = await fixture(t), controller = new AbortController()
    f.state.afterRead = async operation => {
      if (operation.kind !== 'history') return
      if (variant === 'selection') f.state.revision++
      if (variant === 'cancel') controller.abort(new Error('cancelled read'))
      if (variant === 'removed') f.receiver.projects.require = async () => { throw new Error('repository removed') }
    }
    await assert.rejects(f.run(f.parent, { action: 'history' }, controller.signal), /changed|cancelled|removed/)
  }
})
