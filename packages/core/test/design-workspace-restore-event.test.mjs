import assert from 'node:assert/strict'
import { test } from 'node:test'

const { register } = await import('tsx/esm/api')
register()
const { default: DesignService } = await import('../src/design-service.ts')

test('restoring an already-selected project emits a process-local event for derived Panels', async () => {
  const agent = { id: 'restored-agent' }
  const project = { root: '/isolated-nonexistent-restore', projectId: 'restored-project' }
  const events = []
  const service = Object.create(DesignService.prototype)
  service.bindingKey = () => 'binding'
  service.bindings = { read: async () => ({ projectId: project.projectId, revision: 4 }) }
  service.projects = { contentRecoveryLocation: async () => project, require: async () => project, snapshot: async () => ({ checkpoint: 'saved', bundleStates: {} }) }
  service.activeWorkspaces = new Map()
  service.contentRecoveryLocations = new WeakMap()
  service.workspaceContentEpochs = new WeakMap()
  service.projectContentEpochs = new Map()
  service.selectedAgents = new Set()
  service.selectedAgentRefs = new WeakMap()
  service.workspaceChangeListeners = new Set([event => events.push(event)])

  const workspace = await service.restoreWorkspace(agent)
  assert.equal(workspace.project, project)
  assert.deepEqual(events, [{ kind: 'workspace-restored', agent }])
  assert.equal(service.activeWorkspaces.get(agent), workspace)
})
