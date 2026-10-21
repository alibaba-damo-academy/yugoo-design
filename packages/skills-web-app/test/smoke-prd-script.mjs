import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Isolated dependency-boundary regression, not browser/visual acceptance.
async function dependencyBoundary() {
  const root = await mkdtemp(join(tmpdir(), 'prd-renderer-dependencies-'))
  try {
    const renderer = join(root, 'visual-renderer.mjs')
    await writeFile(renderer, await readFile(new URL('../bundles/web_app_prd_assembly/scripts/visual-renderer.mjs', import.meta.url)))
    const prd = join(root, 'prd.mjs')
    await writeFile(prd, await readFile(new URL('../bundles/web_app_prd_assembly/scripts/prd.mjs', import.meta.url)))
    const validation = spawnSync(process.execPath, [prd, 'validate-html-file'], {
      cwd: root, input: '{}\n', encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, NODE_PATH: '', NODE_OPTIONS: '' },
    })
    assert.equal(validation.status, 1, validation.stderr)
    assert.equal(validation.stderr, '')
    assert.equal(validation.signal, null)
    assert.equal(validation.error, undefined)
    const diagnostics = JSON.parse(validation.stdout)
    assert.equal(diagnostics.valid, false)
    assert.ok(diagnostics.diagnostics.includes('schema_version must equal 8'))
    const check = source => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        cwd: root, encoding: 'utf8', timeout: 10000,
        env: { PATH: process.env.PATH, NODE_PATH: '', NODE_OPTIONS: '' },
      })
      assert.equal(result.status, 0, result.stderr || result.stdout)
      assert.equal(result.signal, null)
      assert.equal(result.error, undefined)
    }
    const setup = `import assert from 'node:assert/strict';
      const {renderPrdVisuals,BPMN_RENDERER,PAGE_VIEWPORT}=await import(${JSON.stringify(pathToFileURL(renderer).href)});
      assert.equal(BPMN_RENDERER,'bpmn-js@18.24.0');
      assert.deepEqual(PAGE_VIEWPORT,{width:1440,height:900,deviceScaleFactor:1});`
    check(`${setup}
      assert.deepEqual(await renderPrdVisuals({bpmnItems:[],htmlItems:[]}),{bpmnSvgs:[],htmlScreenshots:[]});
      await assert.rejects(renderPrdVisuals({bpmnItems:[{path:'flow.bpmn',content:'unused'}],htmlItems:[]}),
        error=>error.code==='MODULE_NOT_FOUND'&&error.message.includes('bpmn-js/'));
      await assert.rejects(renderPrdVisuals({bpmnItems:[],htmlItems:[{path:'page.html',ownerHtml:'unused'}]}),
        error=>error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('playwright'));`)
    // A synthetic transport exercises the unchanged HTML branch without
    // launching a browser or manufacturing a real screenshot acceptance.
    const playwright = join(root, 'node_modules/playwright')
    await mkdir(playwright, { recursive: true })
    await writeFile(join(playwright, 'package.json'), JSON.stringify({ name:'playwright', type:'module', exports:'./index.mjs' }))
    await writeFile(join(playwright, 'index.mjs'), `import assert from 'node:assert/strict';
      export const events=[];
      export const chromium={launch:async options=>{
        events.push('launch');
        assert.deepEqual(options,{headless:true});
        return {newPage:()=>assert.fail('HTML-only must not open BPMN page'),
          newContext:async options=>{
            assert.deepEqual(options,{javaScriptEnabled:false,viewport:{width:1440,height:900},deviceScaleFactor:1});
            return {route:async(pattern,handler)=>{assert.equal(pattern,'**/*');handler({abort:()=>events.push('abort')});},
              newPage:async()=>({setContent:async(html,options)=>{assert.equal(html,'<h1>Original owner</h1>');assert.deepEqual(options,{waitUntil:'load'});events.push('content');},
                screenshot:async options=>{assert.deepEqual(options,{type:'png',fullPage:false,animations:'disabled'});events.push('screenshot');return Buffer.from('synthetic');}}),
              close:async()=>events.push('context-close')};},
          close:async()=>events.push('browser-close')};}};`)
    check(`${setup}
      const {events}=await import('playwright');
      assert.deepEqual(await renderPrdVisuals({bpmnItems:[],htmlItems:[{path:'page.html',ownerHtml:'<h1>Original owner</h1>'}]}),
        {bpmnSvgs:[],htmlScreenshots:['data:image/png;base64,c3ludGhldGlj']});
      assert.deepEqual(events,['launch','abort','content','screenshot','context-close','browser-close']);
      await assert.rejects(renderPrdVisuals({bpmnItems:[{path:'flow.bpmn',content:'unused'}],htmlItems:[]}),
        error=>error.code==='MODULE_NOT_FOUND'&&error.message.includes('bpmn-js/'));
      assert.equal(events.length,6,'Missing BPMN must fail before browser launch');`)
    console.log('PRD renderer dependency boundary OK (HTML transport synthetic; no browser acceptance)')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
if (process.argv.includes('--dependency-only')) {
  await dependencyBoundary()
  process.exit(0)
}

const script = new URL('../bundles/web_app_prd_assembly/scripts/prd.mjs', import.meta.url)
const template = await readFile(new URL('../bundles/web_app_prd_assembly/reference/prd-template.html', import.meta.url), 'utf8')

function run(action, html, context) {
  const result = spawnSync(process.execPath, [script.pathname, action], { input: `${JSON.stringify(context)}\n${html}`, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  return { ...result, output: action === 'validate-html-file' || result.status !== 0 ? JSON.parse(result.stdout) : result.stdout }
}

const sectionMatches = [...template.matchAll(/<!--\s*prd-section\s*\n(?<meta>[\s\S]*?)-->\s*\n<h2\b[^>]*\bdata-prd-section-id\s*=\s*(["'])(?<headingId>.*?)\2[^>]*>(?<title>[\s\S]*?)<\/h2\s*>/giu)]
const sections = sectionMatches.map((match, index) => {
  const bodyStart = (match.index ?? 0) + match[0].length
  const bodyEnd = sectionMatches[index + 1]?.index ?? template.length
  return {
    original: template.slice(match.index, sectionMatches[index + 1]?.index ?? template.indexOf('</main>')),
    id: /(?:^|\n)id:\s*(\S+)/u.exec(match.groups.meta)?.[1], title: match.groups.title,
    visuals: [...template.slice(bodyStart, bodyEnd).matchAll(/<!--\s*prd-visual:([A-Za-z0-9_-]+):start\s*-->/gu)].map(item => item[1]),
  }
})
const sourceText = '{"answers":{"audience":"researchers"}}'
const body = sections.map((section, index) => `<h2 data-prd-section-id="${section.id}" data-prd-sources="${index === 0 ? 'smart_questions' : 'user'}" data-prd-provenance-ids="">${section.title}</h2>${section.id === 'capability_architecture' ? '<h3>Core capability</h3><section class="prd-function"><h4>F-001 Example</h4><p class="prd-function-summary">Grounded product content.</p><ul class="prd-function-meta"><li>Actor and entry.</li></ul><ol class="prd-function-flow"><li>Core step.</li></ol><ul class="prd-function-notes"><li>Rule and exception.</li></ul></section>' : '<p>Grounded product content.</p>'}${section.visuals.map(name => `<!-- prd-visual:${name}:start --><!-- prd-visual:${name}:end -->`).join('')}`).join('')
const fixedStyle = /<style\b[^>]*\bdata-prd-document-style\b[^>]*>[\s\S]*?<\/style\s*>/iu.exec(template)?.[0]
assert.ok(fixedStyle)
assert.match(fixedStyle, /\.prd-page-image\s*\{[^}]*width:\s*100%[^}]*aspect-ratio:\s*16\s*\/\s*10/)
assert.doesNotMatch(fixedStyle, /\.prd-page-image\s*\{[^}]*height:\s*640px/)
const html = `<!doctype html><html><head><meta charset="utf-8">${fixedStyle}</head><body class="prd-document"><main class="prd-container">${body}</main></body></html>`
const state = { schema_version: 8, title: 'Product PRD', detail_level: 'concise', ai_provenance: [], html_file: 'web_app_prd_assembly/prd.html' }
const authorityFiles = Object.fromEntries(['business_data', 'business_rules', 'role_access', 'integration_design', 'notification_design', 'quality_acceptance'].map(owner => [`${owner}/${owner}.json`, '{}']))
const input_files = { 'smart_questions/smart_questions.json': sourceText, ...authorityFiles }

const prepared = run('validate-html-file', html, { state, template, input_files })
assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout)
assert.equal(prepared.output.valid, true)

// Exercise the existing single-file workflow: skeleton -> chapter edits ->
// interrupted/reopened file -> remaining edits -> existing final validator.
// This verifies the mechanics, not whether a model will follow the instructions.
const stagedRoot = await mkdtemp(join(tmpdir(), 'prd-bounded-writing-'))
try {
  const target = join(stagedRoot, 'prd.html')
  const stateFile = join(stagedRoot, 'web_app_prd_assembly.json')
  await writeFile(target, template.replaceAll('{{PRD_TITLE}}', state.title))
  await writeFile(stateFile, JSON.stringify({ ...state, html_file: null }))
  assert.equal(run('validate-html-file', await readFile(target, 'utf8'), { state, template, input_files }).status, 1)
  const completedChapters = [...body.matchAll(/<h2\b[\s\S]*?(?=<h2\b|$)/gu)].map(match => match[0])
  assert.equal(completedChapters.length, sections.length)
  for (let index = 0; index < sections.length; index++) {
    // Reopen from disk each time; no in-memory progress is needed to resume.
    const before = await readFile(target, 'utf8')
    const anchor = sections[index].original
    assert.equal(before.split(anchor).length, 2, 'the template chapter anchor is unique')
    const after = before.replace(anchor, completedChapters[index])
    await writeFile(target, after)
    for (let prior = 0; prior <= index; prior++) assert.ok(after.includes(completedChapters[prior]))
    assert.ok(after.includes(fixedStyle), 'edits retain the exact stylesheet')
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).html_file, null)
  }
  const resumed = await readFile(target, 'utf8')
  assert.equal(run('validate-html-file', resumed, { state, template, input_files }).status, 0)
  await writeFile(stateFile, JSON.stringify(state))
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).html_file, state.html_file)
  // Later targeted revisions retain the existing document and reference.
  // Runtime abnormal-idle settlement is deliberately not modeled by this test.
  const revision = resumed.replace('<p>Grounded product content.</p>', '<p>Updated grounded product content.</p>')
  await writeFile(target, revision)
  const reopenedRevision = await readFile(target, 'utf8')
  assert.ok(reopenedRevision.includes('Updated grounded product content.'))
  assert.ok(reopenedRevision.includes(completedChapters.at(-1)))
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).html_file, state.html_file)
  assert.equal(run('validate-html-file', reopenedRevision, { state, template, input_files }).status, 0)
} finally {
  await rm(stagedRoot, { recursive: true, force: true })
}

const tableOnlyCapability = html.replace(/<h3>Core capability<\/h3><section class="prd-function">[\s\S]*?<\/section><!-- prd-visual:function_scope_map:start -->/u, '<h3>Core capability</h3><table><tr><td>Only a compact field summary</td></tr></table><!-- prd-visual:function_scope_map:start -->')
const tableOnlyCapabilityResult = run('validate-html-file', tableOnlyCapability, { state, template, input_files })
assert.equal(tableOnlyCapabilityResult.status, 1)
assert.match(tableOnlyCapabilityResult.output.diagnostics.join('\n'), /capability_architecture.*explanatory prose/)

const restyled = run('validate-html-file', html.replace('</style>', 'body { background: pink; }</style>'), { state, template, input_files })
assert.equal(restyled.status, 1)
assert.match(restyled.output.diagnostics.join('\n'), /stylesheet must exactly match/)

const inlineStyled = run('validate-html-file', html.replace('<p>Grounded product content.</p>', '<p style="color:red">Grounded product content.</p>'), { state, template, input_files })
assert.equal(inlineStyled.status, 1)
assert.match(inlineStyled.output.diagnostics.join('\n'), /must not use inline style/)

const temporaryHtml = html
  .replace('data-prd-provenance-ids=""', 'data-prd-provenance-ids="AI-001"')
  .replace('<p>Grounded product content.</p>', '<div class="ai-provenance" data-provenance-id="AI-001"><p>Temporary decision.</p></div>')
const temporary = {
  id: 'AI-001',
  section_ids: [sections[0].id],
  operation: 'completion',
  description: 'Temporary structural completion',
  source_refs: [],
  assumption: { decision: 'Pending decision', reason: 'No fixed evidence', impact: 'Requires confirmation', decision_owner: 'Product owner' },
}
const temporaryResult = run('validate-html-file', temporaryHtml, { state: { ...state, ai_provenance: [temporary] }, template, input_files })
assert.equal(temporaryResult.status, 0, temporaryResult.stderr || temporaryResult.stdout)

const fakeVerbatim = run('validate-html-file', html.replace('<p>Grounded product content.</p>', '<p class="prd-verbatim-source" data-prd-source-ref="smart_questions/smart_questions.json">Fake quote.</p>'), { state, template, input_files })
assert.equal(fakeVerbatim.status, 1)
assert.match(fakeVerbatim.output.diagnostics.join('\n'), /verbatim text is absent/)

const mismatch = run('validate-html-file', temporaryHtml.replace('data-prd-provenance-ids="AI-001"', 'data-prd-provenance-ids="AI-999"'), { state: { ...state, ai_provenance: [temporary] }, template, input_files })
assert.equal(mismatch.status, 1)
assert.match(mismatch.output.diagnostics.join('\n'), /omits provenance|undeclared provenance/)

const groundedMarkedAsAi = run('validate-html-file', temporaryHtml, { state: { ...state, ai_provenance: [{ ...temporary, operation: 'synthesis', assumption: null }] }, template, input_files })
assert.equal(groundedMarkedAsAi.status, 1)
assert.match(groundedMarkedAsAi.output.diagnostics.join('\n'), /temporary completion|pending assumption/)

const pageMap = '<!-- prd-visual:page_map:start --><!-- prd-visual:page_map:end -->'
const misplacedVisual = run('validate-html-file', html.replace(pageMap, '').replace('</p>', `</p>${pageMap}`), { state, template, input_files })
assert.equal(misplacedVisual.status, 1)
assert.match(misplacedVisual.output.diagnostics.join('\n'), /wrong chapter|must remain inside chapter/)

const unavailable = run('validate-html-file', html, { state, template, input_files: {} })
assert.equal(unavailable.status, 1)
assert.match(unavailable.output.diagnostics.join('\n'), /unavailable source/)

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn:collaboration id="Collaboration_1"><bpmn:participant id="Participant" name="研究流程" processRef="Process_1"/></bpmn:collaboration>
  <bpmn:process id="Process_1"><bpmn:laneSet id="LaneSet"><bpmn:lane id="Lane" name="研究者"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>Task</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:startEvent id="Start" name="开始"><bpmn:outgoing>Flow</bpmn:outgoing></bpmn:startEvent><bpmn:userTask id="Task" name="填写资料"><bpmn:incoming>Flow</bpmn:incoming></bpmn:userTask><bpmn:endEvent id="End" name="完成"/><bpmn:sequenceFlow id="Flow" sourceRef="Start" targetRef="Task"/></bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process_1">
    <bpmndi:BPMNShape id="Participant_di" bpmnElement="Participant"><dc:Bounds x="20" y="40" width="410" height="160"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Lane_di" bpmnElement="Lane"><dc:Bounds x="40" y="50" width="380" height="140"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="80" y="102" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_di" bpmnElement="Task"><dc:Bounds x="170" y="80" width="120" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_di" bpmnElement="End"><dc:Bounds x="350" y="102" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow"><di:waypoint x="116" y="120"/><di:waypoint x="170" y="120"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`
const visualSources = {
  ...authorityFiles,
  'function_modules/function_modules.json': JSON.stringify({ functions: { search: { function_id: 'search', function_name: '文献检索', function_description: '查找文献', function_epic: '研究准备', priority: 'High' } } }),
  'flow_design/flow_design.json': JSON.stringify({ processes: { P1: { process_id: 'P1', title: '研究流程', bpmn_file: 'flow_design/P1.bpmn' } }, process_order: ['P1'] }),
  'flow_design/P1.bpmn': bpmn,
  'page_design/page_design.json': JSON.stringify({ pages: { home: { id: 'home', name: '研究首页', purpose: '查看研究进展', page_type: 'overview', canvas_position: { x: 40, y: 40 }, artifact_file: 'page_design/pages/home.html' } }, page_order: ['home'], connections: {}, connection_order: [] }),
  'page_design/pages/home.html': '<!doctype html>\n<html><head><title>研究首页</title></head>\n<body style="color:var(--ds-primary)">\n<main><h1>研究首页</h1><p>样本量 &lt; 30</p></main>\n</body></html>',
  'design_style/design_style.json': JSON.stringify({ config: { preview_page: { name: 'home', title: '视觉样例', html_file: 'design_style/preview_home.html' } } }),
  'design_style/preview_home.html': '<!doctype html><html><head><link rel="stylesheet" href="./tokens.css"><title>视觉样例</title></head><body><main style="color:var(--ds-primary)">视觉样例</main></body></html>',
  'design_style/tokens.css': ':root{--ds-primary:#6545b8}',
}
const visualOwners = {
  capability_architecture: 'function_modules',
  journeys_processes: 'flow_design',
  pages_interactions: 'page_design',
  visual_experience: 'design_style',
}
const visualBody = sections.map(section => `<h2 data-prd-section-id="${section.id}" data-prd-sources="${visualOwners[section.id] ?? 'user'}" data-prd-provenance-ids="">${section.title}</h2><p>Grounded product content.</p>${section.visuals.map(name => `<!-- prd-visual:${name}:start --><!-- prd-visual:${name}:end -->`).join('')}`).join('')
function withDistributedMarkers(html, name, paths) {
  const markers = paths.map(path => `<section data-prd-entity-ref="${path}"><h3>说明 ${path}</h3><p>该实体的目标、行为、边界和异常说明。</p><!-- prd-visual-item:${path}:start --><!-- prd-visual-item:${path}:end --></section>`).join('\n')
  return html.replace(`<!-- prd-visual:${name}:start --><!-- prd-visual:${name}:end -->`, `<!-- prd-visual:${name}:start -->${markers}<!-- prd-visual:${name}:end -->`)
}
const visualSkeleton = withDistributedMarkers(withDistributedMarkers(
  `<!doctype html><html><head><meta charset="utf-8">${fixedStyle}</head><body class="prd-document"><main class="prd-container">${visualBody}</main></body></html>`,
  'all_bpmn', ['flow_design/P1.bpmn'],
), 'all_page_prototypes', ['page_design/pages/home.html'])

const emptyVisuals = run('validate-html-file', visualSkeleton, { state, template, input_files: visualSources })
assert.equal(emptyVisuals.status, 1)
assert.match(emptyVisuals.output.diagnostics.join('\n'), /must contain exactly one projection/)

const materialized = run('materialize-visuals', visualSkeleton, { input_files: visualSources })
assert.equal(materialized.status, 0, materialized.stderr || materialized.stdout)
for (const ref of ['function_modules/function_modules.json', 'flow_design/P1.bpmn', 'page_design/page_design.json', 'page_design/pages/home.html', 'design_style/preview_home.html']) {
  assert.match(materialized.output, new RegExp(`data-prd-source-ref="${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
}
assert.match(materialized.output, /<svg\b/)
assert.match(materialized.output, /<circle\b/)
assert.match(materialized.output, /<rect\b/)
assert.match(materialized.output, /data-prd-bpmn-renderer="bpmn-js@18\.24\.0"/)
assert.match(materialized.output, /data-element-id="Task"/)
assert.match(materialized.output, /data-prd-source-digest="[a-f0-9]{64}"/)
assert.match(materialized.output, /data-prd-projection-digest="[a-f0-9]{64}"/)
assert.match(materialized.output, />产品功能结构<\/text>/)
assert.match(materialized.output, /data-prd-function-id="search"/)
assert.match(materialized.output, /<img\b[^>]*class="prd-page-image"[^>]*width="1440"[^>]*height="900"[^>]*src="data:image\/png;base64,/)
assert.doesNotMatch(materialized.output, /<iframe\b/)
assert.match(materialized.output, /data-prd-source-dependencies="design_style\/tokens\.css"/)
assert.ok(materialized.output.indexOf('说明 flow_design/P1.bpmn') < materialized.output.indexOf('data-prd-source-ref="flow_design/P1.bpmn"'))
assert.ok(materialized.output.indexOf('说明 page_design/pages/home.html') < materialized.output.indexOf('data-prd-source-ref="page_design/pages/home.html"'))
assert.match(materialized.output, /<section data-prd-entity-ref="flow_design\/P1\.bpmn">[\s\S]*data-prd-source-ref="flow_design\/P1\.bpmn"[\s\S]*<\/section>/)
assert.match(materialized.output, /<section data-prd-entity-ref="page_design\/pages\/home\.html">[\s\S]*data-prd-source-ref="page_design\/pages\/home\.html"[\s\S]*<\/section>/)

const materializedAgain = run('materialize-visuals', materialized.output, { input_files: visualSources })
assert.equal(materializedAgain.status, 0)
assert.equal(materializedAgain.output, materialized.output, 'visual materialization must be idempotent')

const manyPageSources = { ...visualSources }
const manyPageState = JSON.parse(manyPageSources['page_design/page_design.json'])
manyPageState.pages = {}
manyPageState.page_order = []
for (let index = 1; index <= 12; index += 1) {
  const id = `page-${index}`
  const path = `page_design/pages/${id}.html`
  manyPageState.page_order.push(id)
  manyPageState.pages[id] = { id, name: `页面 ${index}`, artifact_file: path }
  manyPageSources[path] = `<!doctype html><html><head><title>页面 ${index}</title></head><body style="color:var(--ds-primary)"><main><h1>页面 ${index}</h1><p>${'完整素材 '.repeat(900)}</p></main></body></html>`
}
manyPageSources['page_design/page_design.json'] = JSON.stringify(manyPageState)
const manyPageSkeleton = withDistributedMarkers(
  visualSkeleton.replace(/<section data-prd-entity-ref="page_design\/pages\/home\.html">[\s\S]*?<\/section>/u, ''),
  'all_page_prototypes',
  manyPageState.page_order.map(id => manyPageState.pages[id].artifact_file),
)
const manyPages = run('materialize-visuals', manyPageSkeleton, { input_files: manyPageSources })
assert.equal(manyPages.status, 0, manyPages.stderr || manyPages.stdout)
for (let index = 1; index <= 12; index += 1) assert.match(manyPages.output, new RegExp(`data-prd-source-ref="page_design/pages/page-${index}\\.html"`))
const manyPagesValidation = run('validate-html-file', manyPages.output, { state, template, input_files: manyPageSources })
assert.equal(manyPagesValidation.status, 0, manyPagesValidation.stderr || manyPagesValidation.stdout)

const missingPageTokensSources = { ...visualSources }
delete missingPageTokensSources['design_style/tokens.css']
delete missingPageTokensSources['design_style/design_style.json']
delete missingPageTokensSources['design_style/preview_home.html']
const missingPageTokens = run('materialize-visuals', visualSkeleton, { input_files: missingPageTokensSources })
assert.equal(missingPageTokens.status, 1)
assert.match(missingPageTokens.output.diagnostics.join('\n'), /required by page prototype/)

const visualValidation = run('validate-html-file', materialized.output, { state, template, input_files: visualSources })
assert.equal(visualValidation.status, 0, visualValidation.stderr || visualValidation.stdout)

const detachedFlowVisual = run('validate-html-file', materialized.output.replace('data-prd-entity-ref="flow_design/P1.bpmn"', 'data-prd-entity-ref="flow_design/other.bpmn"'), { state, template, input_files: visualSources })
assert.equal(detachedFlowVisual.status, 1)
assert.match(detachedFlowVisual.output.diagnostics.join('\n'), /one entity section for "flow_design\/P1.bpmn"/)

assert.match(materialized.output, />主要导航<\/text>/)
assert.match(materialized.output, />关联跳转<\/text>/)

const tamperedBpmnSvg = run('validate-html-file', materialized.output.replace('data-element-id="Task"', 'data-element-id="Task-tampered"'), { state, template, input_files: visualSources })
assert.equal(tamperedBpmnSvg.status, 1)
assert.match(tamperedBpmnSvg.output.diagnostics.join('\n'), /projection integrity check failed/)

const stalePageImage = run('validate-html-file', materialized.output.replace('width="1440"', 'width="720"'), { state, template, input_files: visualSources })
assert.equal(stalePageImage.status, 1)
assert.match(stalePageImage.output.diagnostics.join('\n'), /must preserve the 1440x900 design viewport/)

const changedPageSource = { ...visualSources, 'page_design/pages/home.html': `${visualSources['page_design/pages/home.html']}\n<!-- changed -->` }
const tamperedOwnerHtml = run('validate-html-file', materialized.output, { state, template, input_files: changedPageSource })
assert.equal(tamperedOwnerHtml.status, 1)
assert.match(tamperedOwnerHtml.output.diagnostics.join('\n'), /stale relative to its owner artifact/)

const extraFrame = run('validate-html-file', materialized.output.replace('</body>', '<iframe sandbox=""></iframe></body>'), { state, template, input_files: visualSources })
assert.equal(extraFrame.status, 1)
assert.match(extraFrame.output.diagnostics.join('\n'), /must not rely on iframe previews/)

const missingAcceptanceAuthority = { ...input_files }
delete missingAcceptanceAuthority['quality_acceptance/quality_acceptance.json']
const unmarkedAcceptance = run('validate-html-file', html, { state, template, input_files: missingAcceptanceAuthority })
assert.equal(unmarkedAcceptance.status, 1)
assert.match(unmarkedAcceptance.output.diagnostics.join('\n'), /quality_acceptance.*authority Bundle.*quality_acceptance/)

const qualityCompletion = {
  id: 'AI-QA-001', section_ids: ['quality_acceptance'], operation: 'completion', description: 'Temporary quality targets', source_refs: [],
  assumption: { decision: 'Temporary acceptance targets', reason: 'Quality design is absent', impact: 'Targets require confirmation', decision_owner: 'Product owner' },
}
const qualityHeading = '<h2 data-prd-section-id="quality_acceptance" data-prd-sources="user" data-prd-provenance-ids="">质量与验收</h2><p>Grounded product content.</p>'
const markedQualityHeading = '<h2 data-prd-section-id="quality_acceptance" data-prd-sources="user" data-prd-provenance-ids="AI-QA-001">质量与验收</h2><div class="ai-provenance" data-provenance-id="AI-QA-001"><p>Grounded product content.</p></div>'
const markedAcceptance = run('validate-html-file', html.replace(qualityHeading, markedQualityHeading), { state: { ...state, ai_provenance: [qualityCompletion] }, template, input_files: missingAcceptanceAuthority })
assert.equal(markedAcceptance.status, 0, markedAcceptance.stderr || markedAcceptance.stdout)

const missingArtifactSources = { ...visualSources }
delete missingArtifactSources['page_design/pages/home.html']
const missingArtifact = run('materialize-visuals', visualSkeleton, { input_files: missingArtifactSources })
assert.equal(missingArtifact.status, 1)
assert.match(missingArtifact.output.diagnostics.join('\n'), /referenced by page .* is missing/)

const noDiSources = { ...visualSources, 'flow_design/P1.bpmn': '<definitions><process id="Process_1"/></definitions>' }
const noDi = run('materialize-visuals', visualSkeleton, { input_files: noDiSources })
assert.equal(noDi.status, 1)
assert.match(noDi.output.diagnostics.join('\n'), /cannot render BPMN visual/)

console.log('WEB APP PRD AGENT SCRIPT OK')
