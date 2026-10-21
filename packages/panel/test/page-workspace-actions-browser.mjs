import assert from 'node:assert/strict'

/** Real Page interactions, called by the isolated browser runner. */
export async function checkPageWorkspaceActions({ browser, evalJS, clickText, store, url, metrics }) {
  await browser('set', 'viewport', '1400', '1000')
  await browser('wait', '--fn', 'document.querySelectorAll(".react-flow__node-navigation-record").length === 2')
  const initial = JSON.parse(await evalJS('window.declarativeTestDraft'))
  const initialEdits = JSON.parse(await evalJS('window.declarativeTestEditCount'))
  await clickText('Open detail')
  await browser('wait', '.dsh-navigation-inspector select')
  const emptyPoint = JSON.parse(await evalJS(`(() => {
    const rect = document.querySelector('.dsh-navigation-map').getBoundingClientRect();
    const point = { x: Math.round(rect.left + 20), y: Math.round(rect.top + 20) };
    const hit = document.elementFromPoint(point.x, point.y);
    return { ...point, pane: !!hit?.closest('.react-flow__pane'), node: hit?.closest('.react-flow__node')?.dataset.id };
  })()`))
  assert.equal(emptyPoint.pane, true, 'the clear-selection click must hit actual empty canvas')
  assert.equal(emptyPoint.node, undefined)
  await browser('mouse', 'move', String(emptyPoint.x), String(emptyPoint.y))
  await browser('mouse', 'down'); await browser('mouse', 'up')
  await browser('wait', '--fn', 'document.querySelector(".dsh-navigation-inspector select") === null')
  await browser('dblclick', '[data-id="node:a"] .dsh-navigation-record-node strong')
  await browser('wait', '.dsh-navigation-preview iframe')
  assert.equal(JSON.parse(await evalJS('document.querySelector(".dsh-navigation-map").getBoundingClientRect().height')), 0)
  const addGroup = () => evalJS(`(() => {
    const button = [...document.querySelectorAll('.dsh-panel-workspace-tree-add')].find(item => item.textContent.includes('画布分区'));
    return { present: !!button, disabled: button?.disabled };
  })()`)
  assert.deepEqual(JSON.parse(await addGroup()), { present: true, disabled: true }, 'hidden canvas must disable group creation')
  assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft')), initial)
  assert.equal(JSON.parse(await evalJS('window.declarativeTestEditCount')), initialEdits, 'view gestures must not edit design facts')
  await browser('click', '.dsh-navigation-inspector button[aria-pressed="true"]')
  await browser('wait', '--fn', 'document.querySelector(".dsh-navigation-map").getBoundingClientRect().height > 0')
  await browser('wait', '--fn', `(() => {
    const button = [...document.querySelectorAll('.dsh-panel-workspace-tree-add')].find(item => item.textContent.includes('画布分区'));
    return !!button && button.disabled === false;
  })()`)
  // agent-browser exact-name lookup includes an aria-hidden decoration that
  // its accessibility snapshot excludes. Use a fresh accessible snapshot ref,
  // then a real pointer click; do not force a DOM click or change the product.
  const addSnapshot = await browser('snapshot', '-i')
  const addRefs = [...addSnapshot.matchAll(/button "添加画布分区" \[ref=(e\d+)\]/g)].map(match => match[1])
  assert.equal(addRefs.length, 1, 'exactly one enabled add-group button must exist in the fresh snapshot')
  await browser('click', '@' + addRefs[0])
  await browser('wait', '--fn', 'Object.keys(window.declarativeTestDraft.canvas_sections).length === 1')
  await browser('wait', '.react-flow__node-navigation-frame')
  const added = JSON.parse(await evalJS('window.declarativeTestDraft'))
  assert.deepEqual(added.pages, initial.pages)
  assert.deepEqual(added.connections, initial.connections)
  assert.deepEqual(added.page_order, initial.page_order)
  assert.deepEqual(added.connection_order, initial.connection_order)
  const frame = Object.values(added.canvas_sections)[0]
  assert.deepEqual(frame.page_ids, [])
  assert.ok(Number.isFinite(frame.canvas_position.x) && Number.isFinite(frame.canvas_position.y))
  const position = JSON.parse(await evalJS(`(() => {
    const map = document.querySelector('.dsh-navigation-map').getBoundingClientRect();
    const frame = document.querySelector('.react-flow__node-navigation-frame').getBoundingClientRect();
    return { map: map.toJSON(), frame: frame.toJSON(),
      centerDifference: { x: frame.x + frame.width / 2 - (map.x + map.width / 2),
        y: frame.y + frame.height / 2 - (map.y + map.height / 2) } };
  })()`))
  metrics.push({ label: 'new-frame-viewport-center', ...position })
  assert.ok(Math.abs(position.centerDifference.x) < 3 && Math.abs(position.centerDifference.y) < 3,
    'a new frame must appear centered in the visible canvas')
  await clickText('保存')
  await browser('wait', '--fn', 'document.querySelector("footer [role=status]").textContent === "已保存"')
  const saved = await store.read('page_design')
  assert.deepEqual(saved, added)
  await browser('open', url)
  await browser('wait', '.react-flow__node-navigation-frame')
  assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft')), saved)
  await browser('check', 'footer input[type=checkbox]')
  await browser('wait', '--fn', 'document.querySelectorAll(".dsh-panel-workspace-tree-add").length === 0')
  await browser('dblclick', '[data-id="node:a"] .dsh-navigation-record-node strong')
  await browser('wait', '.dsh-navigation-preview iframe')
  assert.deepEqual(JSON.parse(await evalJS('window.declarativeTestDraft')), saved, 'readonly still permits viewing without editing')
  return ['empty-pane-clears-selection', 'real-double-click-opens-preview', 'view-gestures-do-not-edit',
    'hidden-canvas-disables-group-creation', 'new-frame-centered-in-viewport', 'frame-creation-preserves-other-facts',
    'new-frame-full-state-save-reopen', 'readonly-preview-without-add-controls']
}
