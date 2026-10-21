import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { projectNavigationMap, moveNavigationNodes, editNavigationEdge, bindNavigationHotspot, unbindNavigationHotspot, navigationPreviewLinks } = await import('../src/navigation-map-state.ts')
const { navigationFormUpdates, translateNavigationFrame } = await import('../src/navigation-map-edits.ts')
const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
const { parsePanelManifest, validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { projectArtifactExecution, projectArtifactReceipt } = await import('../src/artifact-execution.ts')
test('page execution display follows matching path and actual readable bytes', () => {
  const attempt = { invocationId: 'run', attemptId: 'page', artifactId: 'a', artifactKind: 'page_html', artifactFile: 'page_design/pages/a.html', role: 'worker', phase: 'working', sequence: 1 }
  assert.equal(projectArtifactExecution('a', [attempt], 'page_html', false, 'pending', attempt.artifactFile).status, 'working')
  const completed = { ...attempt, phase: 'completed', sequence: 2, receipt: { path: attempt.artifactFile, digest: 'new' } }
  assert.equal(projectArtifactExecution('a', [completed], 'page_html', false, 'pending', attempt.artifactFile).status, 'failed')
  assert.equal(projectArtifactExecution('a', [completed], 'page_html', true, 'pending', attempt.artifactFile).status, 'completed')
  assert.equal(projectArtifactReceipt('a', [completed], 'page_html', 'page_design/pages/replacement.html'), undefined)
})
test('schema7 panel declares navigation workspace with separate node and edge bindings', async () => {
  const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/page_design/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(panel), [])
  assert.equal(panel.ui.navigation_map.nodes.label, 'name')
  assert.equal(panel.ui.navigation_map.edges.label, 'label')
  const invalid = structuredClone(panel)
  invalid.ui.navigation_map.edges.target = 'label'
  assert.ok(validatePanelManifest(invalid).length)
  panel.ui.navigation_map.edges.context = 'preview_context'
  assert.deepEqual(validatePanelManifest(panel), [], 'read-only metadata needs no text editor field')
  for (const context of ['source_page_id', 'nested.value', '__proto__']) {
    const bad = structuredClone(panel); bad.ui.navigation_map.edges.context = context
    assert.ok(validatePanelManifest(bad).length)
  }
})
const binding = {
  nodes: { path: 'pages', order: 'page_order', label: 'name', position: 'canvas_position', artifact: 'artifact_file' },
  edges: { path: 'connections', order: 'connection_order', source: 'source_page_id', target: 'target_page_id', label: 'label' },
  frames: { path: 'canvas_sections', label: 'label', members: 'page_ids', position: 'canvas_position', size: 'canvas_size' },
}
const state = {
  pages: { a: { id: 'a', name: 'List', purpose: 'Browse', artifact_file: 'a.html' }, b: { id: 'b', name: 'Detail', purpose: 'Read', artifact_file: 'b.html' } },
  page_order: ['b'], connections: { jump: { id: 'jump', source_page_id: 'a', target_page_id: 'b', label: 'Open', source_element_id: 'button-1' } }, connection_order: ['jump'],
  canvas_sections: { group: { id: 'group', label: 'Workspace', page_ids: ['a', 'b'], canvas_position: { x: 0, y: 0 }, canvas_size: { width: 600, height: 300 } } },
}
test('node deletion clears only incident references and preserves unrelated records and old invalid links', () => {
  const config = { ...binding, entry_ids: 'entry_page_ids', nodes: { ...binding.nodes, parent: 'parent_id' }, reference_lists: [{ path: 'common_spec.navigation', target: 'target_page_id' }] }
  const input = { ...structuredClone(state), entry_page_ids: ['b', 'a'],
    pages: { ...state.pages, a: { ...state.pages.a, parent_id: 'b' }, c: { id: 'c', name: 'Other', artifact_file: 'c.html' } },
    connections: { ...state.connections, old: { id: 'old', source_page_id: 'absent', target_page_id: 'a' } },
    connection_order: ['jump', 'old'],
    common_spec: { layout: 'keep', navigation: [{ id: 'drop', target_page_id: 'b' }, { id: 'keep', target_page_id: 'a' }, { id: 'old', target_page_id: 'missing' }] },
  }
  const frozen = structuredClone(input)
  const next = applyPanelUpdatesToDraft(input, navigationFormUpdates(input, config, { pages: { a: input.pages.a, c: input.pages.c } }))
  assert.deepEqual(input, frozen)
  assert.equal(next.pages.a.parent_id, undefined)
  assert.equal(next.pages.a.artifact_file, null)
  assert.equal(next.pages.c.artifact_file, 'c.html')
  assert.deepEqual(next.entry_page_ids, ['a'])
  assert.deepEqual(next.canvas_sections.group.page_ids, ['a'])
  assert.deepEqual(next.connection_order, ['old'])
  assert.deepEqual(Object.keys(next.connections), ['old'])
  assert.deepEqual(next.page_order, [])
  assert.equal(next.common_spec.layout, 'keep')
  assert.deepEqual(next.common_spec.navigation.map(row => row.id), ['keep', 'old'])
})
test('deleting the last entry leaves an explicit empty list rather than inventing an entry', () => {
  const input = { ...state, entry_page_ids: ['b'] }
  const next = navigationFormUpdates(input, { ...binding, entry_ids: 'entry_page_ids' }, { pages: { a: state.pages.a } })
  assert.deepEqual(next.entry_page_ids, [])
})
test('deletion respects other explicit edits in the same atomic update', () => {
  const config = { ...binding, entry_ids: 'entries', reference_lists: [{ path: 'common.links', target: 'target' }] }
  const input = { ...state, entries: ['b'], common: { links: [{ target: 'b' }, { target: 'a', label: 'Old' }] } }
  const next = applyPanelUpdatesToDraft(input, navigationFormUpdates(input, config, {
    pages: { a: state.pages.a }, entries: ['a'], 'common.links': [{ target: 'a', label: 'New' }, { target: 'b' }],
  }))
  assert.deepEqual(next.entries, ['a'])
  assert.deepEqual(next.common.links, [{ target: 'a', label: 'New' }])
})
test('renaming a record does not trigger deletion cleanup', () => {
  const updates = { pages: { ...state.pages, a: { ...state.pages.a, name: 'Renamed' } } }
  assert.deepEqual(navigationFormUpdates(state, binding, updates), updates)
})
test('explicit hotspot bindings navigate only live endpoints and preserve HTML', () => {
  const config = { ...binding, edges: { ...binding.edges, hotspot: 'source_element_id', hotspot_label: 'source_element_label' } }
  const update = bindNavigationHotspot(state, config, 'a', 'jump', 'read-button', 'Read')
  const next = { ...state, ...update }
  assert.equal(next.pages.a.artifact_file, 'a.html')
  assert.deepEqual(navigationPreviewLinks(next, config, 'a'), [{ id: 'jump', target: 'b', element: 'read-button' }])
  assert.deepEqual(navigationPreviewLinks(next, binding, 'a'), [])
  assert.deepEqual(navigationPreviewLinks({ ...next, pages: { a: next.pages.a } }, config, 'a'), [])
  assert.throws(() => bindNavigationHotspot(state, config, 'b', 'jump', 'read-button', 'Read'))
  assert.throws(() => bindNavigationHotspot({ ...next, connections: { ...next.connections, duplicate: { ...next.connections.jump } } }, config, 'a', 'jump', 'read-button', 'Read'))
})
test('host edge projection preserves valid selection context and reports invalid explicit context', () => {
  const config = { ...binding, edges: { ...binding.edges, hotspot: 'source_element_id', context: 'preview_context' } }
  const input = structuredClone(state)
  input.connections.jump.preview_context = { selection: 'first' }
  const before = structuredClone(input)
  assert.equal(navigationPreviewLinks(input, config, 'a')[0].context.selection, 'first')
  assert.deepEqual(input, before)
  input.connections.jump.preview_context = { selection: 123 }
  const link = navigationPreviewLinks(input, config, 'a')[0]
  assert.equal(link.context, undefined)
  assert.match(link.contextError, /Invalid preview navigation context/)
})
test('map preserves independent labels, partial orders and saved frame geometry', () => {
  const result = projectNavigationMap(state, binding)
  assert.deepEqual(result.nodes.map(n => n.label), ['Detail', 'List'])
  assert.equal(result.edges[0].label, 'Open')
  assert.deepEqual(result.frames[0].members, ['a', 'b'])
  assert.deepEqual(result.frames[0].size, { width: 600, height: 300 })
  assert.deepEqual(result.invalidEdges, [])
})
test('geometry roundtrip preserves artifacts, unrelated fields and input', () => {
  const before = structuredClone(state)
  const update = moveNavigationNodes(state, binding, { a: { x: 25, y: 40 } }, state.canvas_sections)
  assert.equal(update.pages.a.artifact_file, 'a.html')
  assert.equal(update.pages.a.purpose, 'Browse')
  assert.deepEqual(update.pages.a.canvas_position, { x: 25, y: 40 })
  update.canvas_sections.group.label = 'Changed'
  assert.deepEqual(state, before)
  assert.throws(() => moveNavigationNodes(state, binding, { a: { x: NaN, y: 0 } }))
})
test('navigation edits invalidate only affected sources and preserve hotspot evidence', () => {
  const update = editNavigationEdge(state, binding, 'jump', { label: 'Read detail' })
  assert.equal(update.pages.a.artifact_file, null)
  assert.equal(update.pages.b.artifact_file, 'b.html')
  assert.equal(update.connections.jump.source_element_id, 'button-1')
  assert.equal(editNavigationEdge(state, binding, 'jump', { label: 'Open' }).pages, undefined)
  assert.throws(() => editNavigationEdge(state, binding, 'jump', { target_page_id: 'missing' }))
  assert.throws(() => editNavigationEdge(state, binding, 'jump', { html: 'invented' }))
})

test('complete form updates consume edge invalidation and preserve unrelated nodes', () => {
  const updates = navigationFormUpdates(state, binding, { connections: { jump: { ...state.connections.jump, label: 'Inspect' } } })
  assert.equal(updates.connections.jump.label, 'Inspect')
  assert.equal(updates.pages.a.artifact_file, null)
  assert.equal(updates.pages.b.artifact_file, 'b.html')
  assert.equal(state.pages.a.artifact_file, 'a.html')
})

test('moving a frame translates members atomically without invalidating HTML', () => {
  const update = translateNavigationFrame(state, binding, 'group', { x: 40, y: -20 }, { a: { x: 10, y: 30 }, b: { x: 200, y: 60 } })
  assert.deepEqual(update.pages.a.canvas_position, { x: 50, y: 10 })
  assert.deepEqual(update.pages.b.canvas_position, { x: 240, y: 40 })
  assert.deepEqual(update.canvas_sections.group.canvas_position, { x: 40, y: -20 })
  assert.equal(update.pages.a.artifact_file, 'a.html')
  assert.deepEqual(state.canvas_sections.group.canvas_position, { x: 0, y: 0 })
  assert.throws(() => translateNavigationFrame(state, binding, 'group', { x: 0, y: 0 }, {}))
})

test('first frame drag uses explicit displayed origin when no position was saved', () => {
  const old = structuredClone(state); delete old.canvas_sections.group.canvas_position
  const update = translateNavigationFrame(old, binding, 'group', { x: 50, y: 30 }, { a: { x: 10, y: 0 }, b: { x: 20, y: 0 } }, { x: 5, y: 10 })
  assert.deepEqual(update.pages.a.canvas_position, { x: 55, y: 20 })
  assert.equal(old.canvas_sections.group.canvas_position, undefined)
  assert.throws(() => translateNavigationFrame(old, binding, 'group', { x: 50, y: 30 }, {}))
})

test('new and deleted links invalidate source only', () => {
  const removed = navigationFormUpdates(state, binding, { connections: {}, connection_order: [] })
  assert.equal(removed.pages.a.artifact_file, null)
  assert.equal(removed.pages.b.artifact_file, 'b.html')
  const added = navigationFormUpdates(state, binding, { connections: { ...state.connections, back: { id: 'back', source_page_id: 'b', target_page_id: 'a' } } })
  assert.equal(added.pages.a.artifact_file, 'a.html')
  assert.equal(added.pages.b.artifact_file, null)
})

test('real schema7 Panel Save/reopen preserves geometry and scoped artifact invalidation', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { DesignFilesStore } = await import('../../core/src/design-files.ts')
  const { GitVersioning } = await import('../../core/src/git.ts')
  const { applyPanelEdit } = await import('../../core/src/panel-save.ts')
  const { validatorFromSchemaYaml } = await import('../../core/src/schema.ts')
  const exec = promisify(execFile), root = await mkdtemp(join(tmpdir(), 'navigation-save-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error } },
    writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }, ensureDir: path => mkdir(path, { recursive: true }) }
  const spawn = async ({ argv, cwd, env }) => {
    try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } }) } }
    catch (e) { return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } }
  }
  const git = new GitVersioning(spawn, root, 'design_files'); await git.ensureRepo()
  const store = new DesignFilesStore(fs, git, join(root, 'design_files'))
  const validate = validatorFromSchemaYaml(await readFile(new URL('../../skills-web-app/bundles/page_design/schema.yaml', import.meta.url), 'utf8'))
  const initial = { schema_version: 7, stage: 'mapped', ...structuredClone(state), page_order: ['a', 'b'] }
  await applyPanelEdit(store, { skill: 'page_design', state: initial }, async () => {}, validate)
  const moved = { ...initial, ...moveNavigationNodes(initial, binding, { a: { x: 90, y: 30 } }) }
  const changed = { ...moved, ...navigationFormUpdates(moved, binding, { connections: { jump: { ...moved.connections.jump, label: 'Inspect' } } }) }
  await applyPanelEdit(store, { skill: 'page_design', state: changed }, async () => {}, validate)
  const reopened = new DesignFilesStore(fs, new GitVersioning(spawn, root, 'design_files'), join(root, 'design_files'))
  const result = await reopened.read('page_design')
  assert.deepEqual(result, changed)
  assert.equal(result.pages.a.artifact_file, null)
  assert.equal(result.pages.b.artifact_file, 'b.html')
  assert.deepEqual(result.pages.a.canvas_position, { x: 90, y: 30 })
  const hotspotBinding = { ...binding, edges: { ...binding.edges, hotspot: 'source_element_id', hotspot_label: 'source_element_label' } }
  const bound = { ...result, ...bindNavigationHotspot(result, hotspotBinding, 'a', 'jump', 'read-action', 'Read detail') }
  await applyPanelEdit(reopened, { skill: 'page_design', state: bound }, async () => {}, validate)
  const afterBinding = await new DesignFilesStore(fs, new GitVersioning(spawn, root, 'design_files'), join(root, 'design_files')).read('page_design')
  assert.equal(afterBinding.connections.jump.source_element_id, 'read-action')
  assert.equal(afterBinding.connections.jump.source_element_label, 'Read detail')
  assert.deepEqual(navigationPreviewLinks(afterBinding, hotspotBinding, 'a'), [{ id: 'jump', target: 'b', element: 'read-action' }])
  const unbound = { ...afterBinding, ...unbindNavigationHotspot(afterBinding, hotspotBinding, 'jump') }
  assert.equal(afterBinding.connections.jump.source_element_id, 'read-action', 'unbind must not mutate the prior state')
  assert.deepEqual(unbound.connections.jump, Object.fromEntries(Object.entries(afterBinding.connections.jump)
    .filter(([key]) => !['source_element_id', 'source_element_label'].includes(key))))
  assert.deepEqual(navigationPreviewLinks(unbound, hotspotBinding, 'a'), [])
  await applyPanelEdit(reopened, { skill: 'page_design', state: unbound }, async () => {}, validate)
  assert.deepEqual(await new DesignFilesStore(fs, new GitVersioning(spawn, root, 'design_files'), join(root, 'design_files')).read('page_design'), unbound)
  assert.throws(() => unbindNavigationHotspot(unbound, hotspotBinding, 'removed'), /stale/)
  const removedTarget = { ...afterBinding, pages: { a: afterBinding.pages.a } }
  assert.deepEqual(navigationPreviewLinks(removedTarget, hotspotBinding, 'a'), [])
  assert.throws(() => bindNavigationHotspot(removedTarget, hotspotBinding, 'a', 'jump', 'read-action', 'Read detail'))
  const declared = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/page_design/panel.yaml', import.meta.url), 'utf8')).ui.navigation_map
  const withEntries = { ...afterBinding, entry_page_ids: ['b'], common_spec: {
    layout: 'sidebar', logo: { description: 'Research' }, shared_components: ['Toolbar'],
    navigation: [{ id: 'detail', label: 'Detail', target_page_id: 'b' }],
  } }
  const deletion = applyPanelUpdatesToDraft(withEntries, navigationFormUpdates(withEntries, declared, { pages: { a: withEntries.pages.a } }))
  await applyPanelEdit(reopened, { skill: 'page_design', state: deletion }, async () => {}, validate)
  const afterDeletion = await new DesignFilesStore(fs, new GitVersioning(spawn, root, 'design_files'), join(root, 'design_files')).read('page_design')
  assert.deepEqual(afterDeletion, deletion)
  assert.deepEqual(afterDeletion.entry_page_ids, [])
  assert.deepEqual(afterDeletion.connections, {})
  assert.deepEqual(afterDeletion.common_spec.navigation, [])
  assert.deepEqual(afterDeletion.common_spec.shared_components, ['Toolbar'])
  assert.deepEqual(afterDeletion.canvas_sections.group.page_ids, ['a'])
})
