import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createBpmnLabelBoundsModule } from '../src/bpmn-label-bounds.mjs'

const require = createRequire(import.meta.url)
const presentation = JSON.parse(await readFile(new URL('../src/bpmn-presentation.json', import.meta.url)))
const evidence = process.env.BPMN_TEST_EVIDENCE_DIR
const nativeOnly = process.env.BPMN_TEST_NATIVE_IMPORT === '1'
const xml = (width = 140, height = 48, label = true, name = 'In-scope, milestones unchanged') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="urn:label-roundtrip">
<bpmn:process id="Process"><bpmn:task id="First" name="First action"/><bpmn:task id="Next" name="Next action"/><bpmn:sequenceFlow id="Flow" name="${name}" sourceRef="First" targetRef="Next"/></bpmn:process>
<bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process">
<bpmndi:BPMNShape id="First_di" bpmnElement="First"><dc:Bounds x="200" y="500" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="Next_di" bpmnElement="Next"><dc:Bounds x="650" y="740" width="100" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow"><di:waypoint x="300" y="540"/><di:waypoint x="600" y="540"/><di:waypoint x="600" y="780"/><di:waypoint x="650" y="780"/>${label ? `<bpmndi:BPMNLabel><dc:Bounds x="400" y="650" width="${width}" height="${height}"/></bpmndi:BPMNLabel>` : ''}</bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`
const browser = await chromium.launch({ headless: true,
  ...(process.env.BPMN_BROWSER_EXECUTABLE ? { executablePath: process.env.BPMN_BROWSER_EXECUTABLE } : {}) })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="canvas" style="width:1200px;height:1000px"></div>')
  await page.addScriptTag({ path: require.resolve('bpmn-js/dist/bpmn-modeler.development.js') })
  await page.evaluate(() => { window.Modeler = window.BpmnJS })
  await page.addScriptTag({ path: require.resolve('bpmn-js/dist/bpmn-navigated-viewer.development.js') })
  await page.evaluate(() => { window.Viewer = window.BpmnJS })
  await page.addScriptTag({ content: `window.createLabelModule = (${createBpmnLabelBoundsModule.toString()});` })
  await page.evaluate(({ presentation, nativeOnly }) => {
    window.options = () => ({ container: '#canvas', textRenderer: presentation,
      ...(!nativeOnly ? { additionalModules: [window.createLabelModule()] } : {}) })
    window.openDiagram = async (xml, edit = true, native = false) => {
      window.engine?.destroy()
      window.engine = new (edit ? window.Modeler : window.Viewer)({ ...window.options(), ...(native ? { additionalModules: [] } : {}) })
      await window.engine.importXML(xml)
    }
    window.snapshot = () => {
      const engine = window.engine, label = engine.get('elementRegistry').get('Flow_label')
      const gfx = engine.get('elementRegistry').getGraphics(label)
      return { x: label.x, y: label.y, width: label.width, height: label.height,
        lines: [...gfx.querySelectorAll('tspan')].map(t => t.textContent), name: label.businessObject.name }
    }
  }, { presentation, nativeOnly })

  for (const [width, height] of [[140, 48], [111, 29]]) {
    let current = xml(width, height)
    let expectedX = 400
    for (let cycle = 0; cycle < 4; cycle++) {
      await page.evaluate(input => window.openDiagram(input), current)
      const imported = await page.evaluate(() => window.snapshot())
      results.push({ width, cycle, imported })
      assert.equal(imported.width, width, 'explicit DI width shrank on import')
      assert.equal(imported.x, expectedX, 'explicit DI position drifted on import')
      assert.equal(imported.y, 650)
      assert.ok(imported.height >= height, 'explicit DI height shrank on import')
      assert.ok(!imported.lines.some(line => line.trim() === 's'), 'an unchanged word split after import')
      current = await page.evaluate(async () => {
        const label = window.engine.get('elementRegistry').get('Flow_label')
        window.engine.get('modeling').moveShape(label, { x: 8, y: 0 })
        return (await window.engine.saveXML({ format: true })).xml
      })
      expectedX += 8
      await page.evaluate(input => window.openDiagram(input, false), current)
      const reopened = await page.evaluate(() => window.snapshot())
      results.push({ width, cycle, reopened })
      assert.equal(reopened.width, width, 'save/reopen narrowed the explicit text frame')
      assert.equal(reopened.x, expectedX)
      assert.equal(reopened.y, imported.y)
      assert.equal(reopened.height, imported.height, 'text-frame height drifted after save/reopen')
      assert.deepEqual(reopened.lines, imported.lines, 'save/reopen changed wrapping')
    }
  }
  console.log('explicit140/old111: four move/save/reimport cycles + Viewer wrapping PASS')

  const noDi = xml(140, 48, false)
  await page.evaluate(input => window.openDiagram(input, true, true), noDi)
  const native = await page.evaluate(() => window.snapshot())
  await page.evaluate(input => window.openDiagram(input), noDi)
  assert.deepEqual(await page.evaluate(() => window.snapshot()), native, 'missing label DI must retain native import')

  const newlyNamed = xml(140, 48, false, '')
  const editNative = async native => {
    await page.evaluate(({ input, native }) => window.openDiagram(input, true, native), { input: newlyNamed, native })
    return page.evaluate(() => {
      const e = window.engine, connection = e.get('elementRegistry').get('Flow')
      e.get('modeling').updateLabel(connection, 'New approval condition')
      const edited = window.snapshot()
      e.get('commandStack').undo()
      return { edited, revertedName: connection.businessObject.name, labelRemoved: !e.get('elementRegistry').get('Flow_label') }
    })
  }
  assert.deepEqual(await editNative(false), await editNative(true), 'new label and native edit/undo behavior changed')

  await page.evaluate(input => window.openDiagram(input), xml())
  const original = await page.evaluate(() => window.snapshot())
  const undone = await page.evaluate(() => {
    const e = window.engine, connection = e.get('elementRegistry').get('Flow')
    e.get('modeling').updateLabel(connection, 'A changed condition')
    e.get('commandStack').undo()
    return window.snapshot()
  })
  assert.deepEqual(undone, original, 'text edit/undo failed to restore the explicit frame')
  const resized = await page.evaluate(async () => {
    const e = window.engine, label = e.get('elementRegistry').get('Flow_label')
    e.get('modeling').resizeShape(label, { x: label.x, y: label.y, width: 180, height: label.height })
    return (await e.saveXML({ format: true })).xml
  })
  await page.evaluate(input => window.openDiagram(input, false), resized)
  assert.equal((await page.evaluate(() => window.snapshot())).width, 180, 'native manual resize lost on reopen')
  console.log('no DI/new label/text edit/undo/manual resize PASS')
  if (evidence) {
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'generic-label-roundtrip.png') })
  }
} finally {
  if (evidence) {
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, nativeOnly ? 'native-before-results.json' : 'fixed-results.json'), JSON.stringify(results, null, 2) + '\n')
  }
  await browser.close()
}
