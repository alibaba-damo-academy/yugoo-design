import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { buildPrdScript } from '../build.mjs'

// Isolated dependency-boundary regression, not browser/visual acceptance.
async function dependencyBoundary() {
  const root = await mkdtemp(join(tmpdir(), 'prd-renderer-dependencies-'))
  try {
    const scriptRoot = join(root, 'scripts')
    await mkdir(scriptRoot)
    const renderer = join(scriptRoot, 'visual-renderer.mjs')
    await writeFile(renderer, await readFile(new URL('../bundles/web_app_prd_assembly/scripts/visual-renderer.mjs', import.meta.url)))
    const prd = join(scriptRoot, 'prd.mjs')
    await buildPrdScript(new URL('../bundles/web_app_prd_assembly/scripts/prd.mjs', import.meta.url).pathname, scriptRoot)
    // The relocated script retains its complete Bundle-relative template.
    await mkdir(join(root, 'reference'))
    await writeFile(join(root, 'reference/prd-template.html'), await readFile(new URL('../bundles/web_app_prd_assembly/reference/prd-template.html', import.meta.url)))
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
    await rm(join(root, 'reference/prd-template.html'))
    const missingTemplate = spawnSync(process.execPath, [prd, 'validate-html-file'], {
      cwd: root, input: '{}\n', encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, NODE_PATH: '', NODE_OPTIONS: '' },
    })
    assert.equal(missingTemplate.status, 1)
    assert.equal(missingTemplate.stderr, '')
    assert.match(JSON.parse(missingTemplate.stdout).diagnostics.join('\n'), /cannot read Bundle resource reference\/prd-template\.html/)
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
      assert.deepEqual(await renderPrdVisuals({bpmnItems:[],htmlItems:[]}),{bpmnSvgs:[],htmlScreenshots:[],whiteboardImages:[]});
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
      export const launchFailures=[];
      export const chromium={launch:async options=>{
        events.push(options.channel ? 'launch:'+options.channel : 'launch');
        assert.deepEqual(options,{headless:true,...(options.channel ? {channel:options.channel} : {})});
        assert.ok(!options.channel || ['chrome','msedge'].includes(options.channel));
        const failure=launchFailures.shift();
        if(failure) throw new Error(failure);
        return {newPage:()=>assert.fail('HTML-only must not open BPMN page'),
          newContext:async options=>{
            assert.deepEqual(options,{javaScriptEnabled:true,viewport:{width:1440,height:900},deviceScaleFactor:1});
            return {route:async(pattern,handler)=>{assert.equal(pattern,'**/*');handler({abort:()=>events.push('abort')});},
              newPage:async()=>({setContent:async(html,options)=>{assert.equal(html,'<h1>Original owner</h1>');assert.deepEqual(options,{waitUntil:'load'});events.push('content');},
                evaluate:async()=>900,
                screenshot:async options=>{assert.deepEqual(options,{type:'png',fullPage:true,animations:'disabled'});events.push('screenshot');return Buffer.from('synthetic');},close:async()=>events.push('page-close')}),
              close:async()=>events.push('context-close')};},
          close:async()=>events.push('browser-close')};}};`)
    check(`${setup}
      const {events}=await import('playwright');
      assert.deepEqual(await renderPrdVisuals({bpmnItems:[],htmlItems:[{path:'page.html',ownerHtml:'<h1>Original owner</h1>'}]}),
        {bpmnSvgs:[],htmlScreenshots:['data:image/png;base64,c3ludGhldGlj'],whiteboardImages:[]});
      assert.deepEqual(events,['launch','abort','content','screenshot','page-close','context-close','browser-close']);
      await assert.rejects(renderPrdVisuals({bpmnItems:[{path:'flow.bpmn',content:'unused'}],htmlItems:[]}),
        error=>error.code==='MODULE_NOT_FOUND'&&error.message.includes('bpmn-js/'));
      assert.equal(events.length,7,'Missing BPMN must fail before browser launch');`)
    check(`${setup}
      const {events,launchFailures}=await import('playwright');
      const input={bpmnItems:[],htmlItems:[{path:'page.html',ownerHtml:'<h1>Original owner</h1>'}]};
      const missingChromium="browserType.launch: Executable doesn't exist at /missing/cache/chromium-headless-shell\\nInstall instructions";
      const missingChrome="browserType.launch: Chromium distribution 'chrome' is not found at /missing/google-chrome\\nInstall instructions";
      const missingEdge="Chromium distribution 'msedge' is not found at /missing/msedge";
      const rendered=['abort','content','screenshot','page-close','context-close','browser-close'];
      launchFailures.push(missingChromium);
      await renderPrdVisuals(input);
      assert.deepEqual(events,['launch','launch:chrome',...rendered]);
      events.length=0;
      launchFailures.push(missingChromium,missingChrome);
      await renderPrdVisuals(input);
      assert.deepEqual(events,['launch','launch:chrome','launch:msedge',...rendered]);
      events.length=0;
      launchFailures.push(missingChromium,missingChrome,missingEdge);
      await assert.rejects(renderPrdVisuals(input),error=>{
        assert.match(error.message,/No executable was found for Playwright Chromium, installed Chrome or installed Microsoft Edge/);
        for(const text of [missingChromium,missingChrome,missingEdge]) assert.ok(error.message.includes(text));
        assert.match(error.message,/No browser was installed or downloaded/);
        return true;
      });
      assert.deepEqual(events,['launch','launch:chrome','launch:msedge']);
      for(const failure of ['browserType.launch: Target page, context or browser has been closed',
          'browserType.launch: spawn /opt/chrome EACCES',
          'browserType.launch: error while loading shared libraries: libnss3.so',
          'browserType.launch: Unsupported chromium channel "chrome"',
          "browserType.launch: crashed; log: Executable doesn't exist at /unrelated"]) {
        events.length=0;
        launchFailures.push(failure);
        await assert.rejects(renderPrdVisuals(input),error=>error.cause.message===failure);
        assert.deepEqual(events,['launch'],'Other launch errors must not try another channel');
      }
      events.length=0;
      const chromeCrash='browserType.launch: installed Chrome process exited with SIGSEGV';
      launchFailures.push(missingChromium,chromeCrash);
      await assert.rejects(renderPrdVisuals(input),error=>error.cause.message===chromeCrash);
      assert.deepEqual(events,['launch','launch:chrome'],'Chrome failure must not be hidden by Edge');`)
    await mkdir(join(scriptRoot, 'assets'), { recursive: true })
    await writeFile(join(scriptRoot, 'assets/bpmn-viewer.js'), '/* synthetic bundled asset */')
    await writeFile(join(scriptRoot, 'assets/bpmn-presentation.json'), '{}')
    check(`${setup}
      await assert.rejects(renderPrdVisuals({bpmnItems:[],htmlItems:[{path:'page.html',ownerHtml:'unused'}]}),
        /Packaged browser runtime is missing/);`)
    console.log('PRD renderer dependency boundary OK (HTML transport synthetic; no browser acceptance)')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
if (process.argv.includes('--dependency-only')) {
  await dependencyBoundary()
  process.exit(0)
}

const testBundleRoot = process.env.YUGOO_PRD_TEST_BUNDLE_ROOT
const script = testBundleRoot ? pathToFileURL(join(testBundleRoot, 'scripts/prd.mjs')) : new URL('../bundles/web_app_prd_assembly/scripts/prd.mjs', import.meta.url)
const template = await readFile(testBundleRoot ? join(testBundleRoot, 'reference/prd-template.html') : new URL('../bundles/web_app_prd_assembly/reference/prd-template.html', import.meta.url), 'utf8')

function run(action, html, context) {
  const result = spawnSync(process.execPath, [script.pathname, action], { input: `${JSON.stringify(context)}\n${html}`, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  return { ...result, output: action === 'validate-html-file' || result.status !== 0 ? JSON.parse(result.stdout) : result.stdout }
}

async function htmlInitializationBoundary() {
  const root = await mkdtemp(join(tmpdir(), 'prd-html-initialization-'))
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    response.end('window.remoteOwnerScriptRan = true')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const remote = `http://127.0.0.1:${server.address().port}/owner-resource`
    const local = join(root, 'local-canary.txt')
    await writeFile(local, 'LOCAL_FILE_MUST_NOT_ENTER_THE_PREVIEW')
    const rows = ['Request submitted', 'Lead returned with a reason', 'Revised request resubmitted']
    const body = label => `<main id="timeline"><h1 data-prototype-id="context-first">${label}</h1><ol data-prototype-id="context-second">${rows.map(row => `<li>${row}</li>`).join('')}</ol></main>`
    const document = (label, dynamic, contextual = false) => `<!doctype html><html><head><style>
      body{margin:0;background:#fff;font:24px sans-serif;color:var(--ds-primary)}
      main{padding:32px}li{padding:12px}
      </style></head><body>${dynamic ? '<main id="timeline"></main>' : body(label)}${dynamic ? `
      <script src="${remote}"></script><script>
      const ownerLabel = ${contextual ? `JSON.parse(document.getElementById('dsh-design-preview-context')?.textContent || '{}').selection || 'No selection'` : JSON.stringify(label)};
      (async () => {
        const previousOwner = window.previousOwner;
        window.previousOwner = ownerLabel;
        const reads = await Promise.allSettled([fetch(${JSON.stringify(remote)}), fetch(${JSON.stringify(pathToFileURL(local).href)})]);
        if (previousOwner !== undefined || window.remoteOwnerScriptRan || reads.some(read => read.status === 'fulfilled')) {
          document.body.style.background = '#ff00ff';
          return;
        }
        document.getElementById('timeline').outerHTML = ${JSON.stringify(body(label))};
        document.getElementById('timeline').querySelector('h1').textContent = ownerLabel;
      })();
      </script>` : ''}</body></html>`
    const paths = ['page_design/pages/request-detail.html', 'page_design/pages/another-request.html']
    const labels = ['Request Detail', 'Another Request']
    const sources = dynamic => ({
      'page_design/page_design.json': JSON.stringify({ pages: Object.fromEntries(paths.map((path, index) =>
        [`page-${index}`, { id: `page-${index}`, name: labels[index], artifact_file: path }])), page_order: ['page-0', 'page-1'] }),
      'design_style/tokens.css': ':root{--ds-primary:#243c34}',
      ...Object.fromEntries(paths.map((path, index) => [path, document(labels[index], dynamic)])),
    })
    const regions = [...new Set([...template.matchAll(/<!--\s*prd-visual:([A-Za-z0-9_-]+):start\s*-->/gu)].map(match => match[1]))]
    const skeleton = `<!doctype html><html><body>${regions.map(name => `<!-- prd-visual:${name}:start -->${name === 'all_page_prototypes'
      ? paths.map(path => `<!-- prd-visual-item:${path}:start --><!-- prd-visual-item:${path}:end -->`).join('') : ''}<!-- prd-visual:${name}:end -->`).join('')}</body></html>`
    const materialize = input_files => new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [script.pathname, 'materialize-visuals'], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stderr}\n${stdout.slice(0, 1500)}`))
        else resolve(stdout)
      })
      child.stdin.end(`${JSON.stringify({ input_files })}\n${skeleton}`)
    })
    const images = html => new Map([...html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/giu)].flatMap(match => {
      const path = /data-prd-source-ref="([^"]+)"/u.exec(match[1])?.[1]
      const png = /src="(data:image\/png;base64,[^"]+)"/u.exec(match[2])?.[1]
      return path && png ? [[path, png]] : []
    }))
    const expected = images(await materialize(sources(false)))
    const initialized = images(await materialize(sources(true)))
    assert.equal(expected.size, 2)
    assert.equal(initialized.size, 2)
    for (const [index, path] of paths.entries()) {
      const actual = initialized.get(path), control = expected.get(path)
      if (process.env.YUGOO_PRD_TEST_OUTPUT_DIR) {
        await mkdir(process.env.YUGOO_PRD_TEST_OUTPUT_DIR, { recursive: true })
        await writeFile(join(process.env.YUGOO_PRD_TEST_OUTPUT_DIR, `initialized-${index + 1}.png`), Buffer.from(actual.split(',')[1], 'base64'))
        await writeFile(join(process.env.YUGOO_PRD_TEST_OUTPUT_DIR, `expected-${index + 1}.png`), Buffer.from(control.split(',')[1], 'base64'))
      }
      assert.ok(actual === control, `${path}: initialized DOM must enter the PNG in a fresh page (actual ${createHash('sha256').update(actual).digest('hex')}, expected ${createHash('sha256').update(control).digest('hex')})`)
    }
    const contextual = sources(true)
    contextual[paths[0]] = document(labels[0], true, true)
    const pageIndex = JSON.parse(contextual['page_design/page_design.json'])
    pageIndex.connections = Object.fromEntries(labels.map((label, index) => [`choice-${index}`, {
      source_page_id: 'page-1', target_page_id: 'page-0', label,
      source_element_id: index === 0 ? 'context-first' : 'context-second', preview_context: { selection: label },
    }]))
    pageIndex.connection_order = ['choice-0', 'choice-1']
    contextual['page_design/page_design.json'] = JSON.stringify(pageIndex)
    const firstProjection = await materialize(contextual)
    assert.equal(images(firstProjection).get(paths[0]), expected.get(paths[0]), 'canonical first arrival initializes the target before owner JS')
    assert.ok(firstProjection.includes(`data-prd-source-dependencies="design_style/tokens.css,page_design/page_design.json"`))
    pageIndex.connection_order.reverse()
    contextual['page_design/page_design.json'] = JSON.stringify(pageIndex)
    const secondProjection = await materialize(contextual)
    if (process.env.YUGOO_PRD_TEST_OUTPUT_DIR) {
      await writeFile(join(process.env.YUGOO_PRD_TEST_OUTPUT_DIR, 'context-second-actual.png'), Buffer.from(images(secondProjection).get(paths[0]).split(',')[1], 'base64'))
      await writeFile(join(process.env.YUGOO_PRD_TEST_OUTPUT_DIR, 'context-second-expected.png'), Buffer.from(expected.get(paths[1]).split(',')[1], 'base64'))
    }
    assert.ok(images(secondProjection).get(paths[0]) === expected.get(paths[1]), 'changing canonical arrival selects the other existing content without changing owner HTML')
    const sourceDigest = html => new RegExp(`data-prd-source-ref="${paths[0]}" data-prd-source-digest="([^"]+)"`).exec(html)?.[1]
    assert.notEqual(sourceDigest(firstProjection), sourceDigest(secondProjection), 'context-only changes invalidate the old figure input digest')
    pageIndex.connections['choice-1'].preview_context = { selection: {} }
    contextual['page_design/page_design.json'] = JSON.stringify(pageIndex)
    await assert.rejects(materialize(contextual), /Invalid preview navigation context/)

    const longSources = sources(false)
    longSources[paths[0]] = '<!doctype html><html><head><style>body{margin:0}main{height:2200px}footer{height:100px;background:rgb(17,204,85)}</style></head><body><aside style="position:fixed;top:0;bottom:0;left:0;width:64px;background:rgb(36,72,108)"><div style="position:absolute;bottom:0;height:32px;width:100%;background:rgb(255,170,0)">Nav end</div></aside><main>Long request history</main><footer>END OF LONG PAGE</footer></body></html>'
    const longProjection = await materialize(longSources)
    const longImage = images(longProjection).get(paths[0])
    const png = Buffer.from(longImage.split(',')[1], 'base64')
    assert.equal(png.readUInt32BE(16), 1440)
    assert.equal(png.readUInt32BE(20), 2300, 'the PNG must include the footer below the original 900px viewport')
    assert.match(longProjection, /class="prd-page-image"[^>]*width="1440"[^>]*height="2300"/)
    if (process.env.YUGOO_PRD_TEST_OUTPUT_DIR) await writeFile(join(process.env.YUGOO_PRD_TEST_OUTPUT_DIR, 'full-page.png'), png)

    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
      const imageTag = /<img\b[^>]*class="prd-page-image"[^>]*>/u.exec(longProjection)[0]
      await page.setContent(`<!doctype html><html><head>${fixedStyle}</head><body class="prd-document"><main class="prd-container">${imageTag}</main></body></html>`)
      for (const width of [1000, 425]) {
        await page.setViewportSize({ width, height: 700 })
        const rendered = await page.locator('img').evaluate(async image => {
          await image.decode()
          const box = image.getBoundingClientRect(), style = getComputedStyle(image)
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
          return {
            width: box.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
            height: box.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth),
            footer: [...context.getImageData(100, image.naturalHeight - 50, 1, 1).data],
            sidebarMiddle: [...context.getImageData(20, Math.floor(image.naturalHeight / 2), 1, 1).data],
            sidebarBottom: [...context.getImageData(20, image.naturalHeight - 16, 1, 1).data],
          }
        })
        assert.deepEqual(rendered.footer, [17, 204, 85, 255], 'the embedded PNG contains the actual bottom content')
        assert.deepEqual(rendered.sidebarMiddle, [36, 72, 108, 255], 'fixed sidebar covers the middle of the full-height capture')
        assert.deepEqual(rendered.sidebarBottom, [255, 170, 0, 255], 'fixed sidebar footer stays at the captured bottom')
        assert.ok(Math.abs(rendered.height - rendered.width * 2300 / 1440) < 1, 'wide and narrow report layouts retain the image ratio')
      }
    } finally {
      await browser.close()
    }
    assert.deepEqual(requests, [], 'owner initialization must not fetch external scripts or network data')
    console.log('PRD actual PNG initialization, full-page footer, natural report ratio and offline network/file boundary OK')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}
if (process.argv.includes('--html-initialization-only')) {
  await htmlInitializationBoundary()
  process.exit(0)
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
assert.match(fixedStyle, /\.prd-page-image\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/)
assert.doesNotMatch(fixedStyle, /\.prd-page-image\s*\{[^}]*aspect-ratio:/)
assert.doesNotMatch(fixedStyle, /\.prd-page-image\s*\{[^}]*height:\s*640px/)
const html = `<!doctype html><html><head><meta charset="utf-8">${fixedStyle}</head><body class="prd-document"><main class="prd-container">${body}</main></body></html>`
const state = { schema_version: 8, title: 'Product PRD', detail_level: 'concise', ai_provenance: [], html_file: 'web_app_prd_assembly/prd.html' }
const authorityFiles = Object.fromEntries(['business_data', 'business_rules', 'role_access', 'integration_design', 'notification_design', 'quality_acceptance'].map(owner => [`${owner}/${owner}.json`, '{}']))
const input_files = { 'smart_questions/smart_questions.json': sourceText, ...authorityFiles }

const prepared = run('validate-html-file', html, { state, template, input_files })
const mistakenTitle = { ...state, product_title: state.title }
delete mistakenTitle.title
const titleDiagnostic = JSON.parse(run('validate-html-file', html, { state: mistakenTitle, template, input_files }).stdout)
assert.ok(titleDiagnostic.diagnostics.some(text => text.startsWith('state.title must not be empty') && text.includes('JSON state')))
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
const forgedTemplate = run('validate-html-file', html.replace('</style>', 'body { background: pink; }</style>'), {
  state, template: template.replace('</style>', 'body { background: pink; }</style>'), input_files,
})
assert.equal(forgedTemplate.status, 1, 'caller-supplied template cannot redefine the Bundle validation baseline')
assert.match(forgedTemplate.output.diagnostics.join('\n'), /stylesheet must exactly match/)

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

// The default finalizer accepts only a complete projected/validated document.
// No visuals means this format boundary requires no browser capability.
const finalized = run('finalize-html-file', html, { state, template, input_files })
assert.equal(finalized.status, 0, finalized.stderr || finalized.stdout)
assert.equal(run('validate-html-file', finalized.output, { state, template, input_files }).status, 0)
assert.equal(run('validate-html-file', finalized.output, { state, input_files }).status, 0,
  'validation reads the Bundle template without a duplicate context field')
const validationWithOutput = run('validate-html-file', finalized.output, {
  state, input_files, script_io: { input_file: 'web_app_prd_assembly/prd.html', output_file: 'web_app_prd_assembly/validation-probe.html' },
})
assert.equal(validationWithOutput.status, 1, 'read-only diagnostics must not be accepted as artifact output')
assert.match(validationWithOutput.output.diagnostics.join('\n'), /returns JSON diagnostics.*omit output_file/)
assert.doesNotMatch(validationWithOutput.stdout, /<!doctype html>/i)
assert.equal(run('validate-html-file', finalized.output, {
  state, input_files, script_io: { input_file: 'web_app_prd_assembly/prd.html', output_file: null },
}).status, 0, 'read-only validation still succeeds with no artifact destination')
const rejectedFinal = run('finalize-html-file', html.replace('data-prd-provenance-ids=""', ''), { state, template, input_files })
assert.equal(rejectedFinal.status, 1)
assert.equal(rejectedFinal.output.valid, false)
assert.match(rejectedFinal.output.diagnostics.join('\n'), /provenance/)
assert.doesNotMatch(rejectedFinal.stdout, /<!doctype html>/i, 'failure returns diagnostics, never partial output HTML')
// An omitted owner index must not turn supplied source visuals into an empty
// plan, even if a retry has removed their inline figure directives.
for (const [indexPath, artifactPath, content] of [
  ['flow_design/flow_design.json', 'flow_design/P001.bpmn', '<definitions/>'],
  ['page_design/page_design.json', 'page_design/pages/home.html', '<h1>Source page</h1>'],
  ['design_style/design_style.json', 'design_style/preview.html', '<h1>Source style</h1>'],
  ['whiteboard/whiteboard.json', 'whiteboard/boards/idea.json', '{"elements":[]}'],
]) {
  const sources = { ...input_files, [artifactPath]: content }
  for (const action of ['finalize-html-file', 'validate-html-file']) {
    const missingIndex = run(action, html, { state, template, input_files: sources })
    assert.equal(missingIndex.status, 1, `${action} must reject the missing ${indexPath}`)
    const diagnostic = missingIndex.output.diagnostics.find(message => message.includes('missing its canonical owner index'))
    assert.ok(diagnostic?.includes(indexPath) && diagnostic.includes(artifactPath), missingIndex.stdout)
    assert.doesNotMatch(missingIndex.stdout, /<!doctype html>/i)
  }
}
const whiteboardIndex = { boards: { idea: { id: 'idea', title: 'Source board', artifact_file: 'whiteboard/boards/idea.json' } }, board_order: ['idea'] }
const missingWhiteboard = run('finalize-html-file', html, { state, template, input_files: {
  ...input_files, 'whiteboard/whiteboard.json': JSON.stringify(whiteboardIndex),
} })
assert.equal(missingWhiteboard.status, 1)
assert.match(missingWhiteboard.output.diagnostics.join('\n'), /whiteboard.*missing/)
const pathOnlyImage = run('finalize-html-file', html, { state, template, input_files: {
  ...input_files, 'whiteboard/whiteboard.json': JSON.stringify(whiteboardIndex),
  'whiteboard/boards/idea.json': JSON.stringify({ elements: [{ type: 'image', fileId: 'img' }], appState: {}, files: { img: { path: 'whiteboard/attachments/img.png', mimeType: 'image/png' } } }),
} })
assert.equal(pathOnlyImage.status, 1)
assert.match(pathOnlyImage.output.diagnostics.join('\n'), /needs exact image bytes.*path-only attachments/)
// Synthetic empty-scene projection checks the persisted source/dimension
// binding only; it is not evidence that a native browser rendered a scene.
const emptyScene = JSON.stringify({ elements: [], appState: {}, files: {} })
const emptyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/h9sAAAAASUVORK5CYII='
const sha = value => createHash('sha256').update(value).digest('hex')
const whiteboardSources = { ...input_files, 'whiteboard/whiteboard.json': JSON.stringify(whiteboardIndex), 'whiteboard/boards/idea.json': emptyScene }
const whiteboardFigure = `<section data-prd-entity-ref="whiteboard/boards/idea.json"><p>Source board is intentionally empty.</p><!-- prd-visual-item:whiteboard/boards/idea.json:start --><figure class="prd-visual-figure" data-prd-source-ref="whiteboard/boards/idea.json" data-prd-source-digest="${sha(emptyScene)}" data-prd-projection-digest="${sha(emptyPng)}"><figcaption class="prd-visual-caption">Source board</figcaption><img class="prd-whiteboard-image" data-prd-whiteboard-renderer="excalidraw@0.18.1" alt="Source board" width="1" height="1" src="${emptyPng}"></figure><!-- prd-visual-item:whiteboard/boards/idea.json:end --></section>`
const whiteboardHtml = html.replace('data-prd-section-id="design_explanations" data-prd-sources="user"', 'data-prd-section-id="design_explanations" data-prd-sources="whiteboard"')
  .replace('<!-- prd-visual:all_whiteboards:start --><!-- prd-visual:all_whiteboards:end -->', `<!-- prd-visual:all_whiteboards:start -->${whiteboardFigure}<!-- prd-visual:all_whiteboards:end -->`)
const boardValidation = run('validate-html-file', whiteboardHtml, { state, template, input_files: whiteboardSources })
assert.equal(boardValidation.status, 0, boardValidation.stdout)
const unusedSceneImage = JSON.stringify({ elements: [], appState: {}, files: { old: { path: 'whiteboard/attachments/old.png', mimeType: 'image/png' } } })
const unusedImageValidation = run('validate-html-file', whiteboardHtml.replace(sha(emptyScene), sha(unusedSceneImage)), { state, template, input_files: { ...whiteboardSources, 'whiteboard/boards/idea.json': unusedSceneImage } })
assert.equal(unusedImageValidation.status, 0, 'retained undo image refs do not obstruct projection of an empty scene')
const changedBoard = run('validate-html-file', whiteboardHtml, { state, template, input_files: { ...whiteboardSources, 'whiteboard/boards/idea.json': emptyScene + ' ' } })
assert.equal(changedBoard.status, 1)
assert.match(changedBoard.output.diagnostics.join('\n'), /stale relative to its owner scene/)
const wrongBoardRatio = run('validate-html-file', whiteboardHtml.replace('width="1" height="1"', 'width="2" height="1"'), { state, template, input_files: whiteboardSources })
assert.equal(wrongBoardRatio.status, 1)
assert.match(wrongBoardRatio.output.diagnostics.join('\n'), /native image ratio and dimensions/)
const extraBoardImage = run('validate-html-file', whiteboardHtml.replace('</figure>', '<img class="prd-whiteboard-image" src="data:image/png;base64,extra"></figure>'), { state, template, input_files: whiteboardSources })
assert.equal(extraBoardImage.status, 1)
assert.match(extraBoardImage.output.diagnostics.join('\n'), /exactly 1 rendered Whiteboard image/)
if (process.argv.includes('--format-only')) {
  console.log('PRD format/finalization/source boundaries OK (no browser rendering)')
  process.exit(0)
}

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
assert.match(stalePageImage.output.diagnostics.join('\n'), /must preserve its actual PNG dimensions and aspect ratio/)

const wrongPageHeight = run('validate-html-file', materialized.output.replace(/(<img\b[^>]*class="prd-page-image"[^>]*height=")900"/u, (_match, prefix) => `${prefix}901"`), { state, template, input_files: visualSources })
assert.equal(wrongPageHeight.status, 1)
assert.match(wrongPageHeight.output.diagnostics.join('\n'), /must preserve its actual PNG dimensions and aspect ratio/)

const brokenPagePng = run('validate-html-file', materialized.output.replace(/(<img\b[^>]*class="prd-page-image"[^>]*src=")data:image\/png;base64,[^"]+/u, '$1data:image/png;base64,bm90LWEtcG5n'), { state, template, input_files: visualSources })
assert.equal(brokenPagePng.status, 1)
assert.match(brokenPagePng.output.diagnostics.join('\n'), /must be embedded as a rendered PNG preview/)

const oldCaptureDigest = createHash('sha256').update(visualSources['page_design/pages/home.html']).digest('hex')
const oldCapture = run('validate-html-file', materialized.output.replace(/(data-prd-source-ref="page_design\/pages\/home.html" data-prd-source-digest=")[^"]+/u, (_match, prefix) => prefix + oldCaptureDigest), { state, template, input_files: visualSources })
assert.equal(oldCapture.status, 1)
assert.match(oldCapture.output.diagnostics.join('\n'), /stale relative to its owner artifact, preview context or capture settings/)

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

await htmlInitializationBoundary()
console.log('WEB APP PRD AGENT SCRIPT OK')
