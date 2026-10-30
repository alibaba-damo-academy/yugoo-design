/** Server-render acceptance for the read-only Kit-first Studio React surface. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { controlStyleGaps, feedbackStyleGaps } from './control-style-coverage.mjs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StudioWorkspace, StudioWorkspaceController, STUDIO_WORKSPACE_CSS } from '../lib/index.js'

const source = [
  '---', 'name: "web_app"', 'version: "1.0"', '---', '', '# Web App', '',
  'Compare the available evidence.',
  '| Current **evidence** | Candidate | Do not infer |',
  '| :--- | :---: | ---: |',
  '| A \\| B | `research` | <img src=x onerror=alert(1)> |',
  '| Short row | `questions` |', '',
  'Name | Count', '--- | ---:', 'One | 1', '',
  '```md', '| Example | Only |', '| --- | --- |', '| No | table |', '```', '',
  'Not | a table', '--- | invalid delimiter', '',
  '<design_skills>', '', '## questions', '', '</design_skills>', '',
].join('\n')
const description = '- **Capability**: capture product intent.'
const kitWorkspace = Object.freeze({
  name: 'web_app',
  version: '1.0',
  description: 'Capture product intent',
  displayDescription: Object.freeze({ zh: '中文套件简介', en: 'Bilingual Kit introduction' }),
  mindsetSource: source,
  mounts: Object.freeze([{
    name: 'questions',
    version: '1.0',
    description,
    mountedBy: Object.freeze([{ name: 'web_app', version: '1.0' }]),
  }]),
  resources: Object.freeze([{ path: 'shared/reference/a.md', bytes: 4 }]),
  relationVocabulary: Object.freeze({schemaVersion:1,pin:'kit-v1:abc',relations:Object.freeze([Object.freeze({
    type:'web_app:validates',meaning:'supports',direction:'forward',label:Object.freeze({zh:'验证',en:'Validates'}),description:Object.freeze({zh:'验证关系',en:'Validation relation'}),
  })])}),
})
const skillMd = '---\nname: questions\ndescription: "Capture product intent."\n---\n\n# questions\n\nMethod body.\n'
const skillYaml = 'name: questions\nversion: "1.0"\npresentation:\n  mode: native\n'
const bundleFiles = Object.freeze([
  Object.freeze({ path: 'SKILL.md', bytes: new TextEncoder().encode(skillMd).length }),
  Object.freeze({ path: 'skill.yaml', bytes: new TextEncoder().encode(skillYaml).length }),
  Object.freeze({ path: 'reference/examples/method.md', bytes: 5 }),
])
const fileContents = { 'SKILL.md': skillMd, 'skill.yaml': skillYaml }
const bundleWorkspace = Object.freeze({
  name: 'questions',
  version: '1.0',
  kit: 'web_app',
  description: 'Capture product intent',
  files: bundleFiles,
  displayDescription: Object.freeze({ zh: '中文技能包简介', en: 'Bilingual Bundle introduction' }),
  manifest: Object.freeze({ name: 'questions', version: '1.0', presentation: Object.freeze({ mode: 'native', renderer: 'example.design.questions/v1' }) }),
  schema: Object.freeze({ type: 'object', properties: Object.freeze({ summary: { type: 'string' } }), required: Object.freeze(['summary']) }),
  validation: Object.freeze({ rules: 2, drivers: Object.freeze([]) }),
  panel: Object.freeze({ kind: 'native', renderer: 'example.design.questions/v1' }),
})
const client = {
  async workspace() {
    return Object.freeze({
      query: '',
      kits: Object.freeze([{ name: 'web_app', version: '1.0', description: kitWorkspace.description, displayDescription: kitWorkspace.displayDescription }]),
      bundles: Object.freeze([{
        name: 'questions',
        version: '1.0',
        description,
        usedBy: Object.freeze([{ name: 'web_app', version: '1.0' }]),
      }]),
    })
  },
  async readKitWorkspace(name, version) {
    if (name !== 'web_app' || version !== '1.0') {
      return Object.freeze({ diagnostics: Object.freeze([{ code: 'workspace.kit_missing', message: `no installed Kit ${name}@${version}`, subject: name }]) })
    }
    return Object.freeze({ workspace: kitWorkspace, diagnostics: Object.freeze([]) })
  },
  async readBundleWorkspace(name) {
    if (name !== 'questions') {
      return Object.freeze({ diagnostics: Object.freeze([{ code: 'bundle.missing', message: `no source Bundle ${name}`, subject: name }]) })
    }
    return Object.freeze({ workspace: bundleWorkspace, diagnostics: Object.freeze([]) })
  },
  async readBundleFile({ name, path }) {
    if (name !== 'questions' || fileContents[path] === undefined) {
      return Object.freeze({ diagnostics: Object.freeze([{ code: 'bundle_file.missing', message: `no file ${path}`, subject: path }]) })
    }
    return Object.freeze({ file: Object.freeze({ path, content: fileContents[path] }), diagnostics: Object.freeze([]) })
  },
}
const controller = new StudioWorkspaceController(client)
await controller.load()
const render = () => renderToStaticMarkup(createElement(StudioWorkspace, { client, controller, locale: 'en' }))

test('Studio control style coverage respects authored selectors and foreign-content owners', t => {
  const { JSDOM } = createRequire(new URL('../../panel/package.json', import.meta.url))('jsdom')
  const styleWindow = new JSDOM('').window
  t.after(() => styleWindow.close())
  // Inert documents retain the injected real CSS without JSDOM's older CSSOM
  // discarding modern @container syntax. The helper parses it independently.
  const gaps = (markup, css = STUDIO_WORKSPACE_CSS) => controlStyleGaps(new styleWindow.DOMParser().parseFromString(markup, 'text/html'), css)
  const foreignContent = '.ygd-studio-live-pane-body, .ygd-studio-component-stage, .ygd-studio-markdown'
  const html = render()
  assert.deepEqual(gaps(html), [], 'the rendered Studio catalog controls have authored typography and appearance')
  const controlFixture = body => `<section class="ygd-studio-workspace"><style>${STUDIO_WORKSPACE_CSS}</style>${body}</section>`
  assert.deepEqual(gaps(controlFixture('<div class="ygd-studio-instance-menu"><div><button>Rename</button></div></div>')), [], 'context selectors style menu children without per-control classes')
  assert.deepEqual(gaps(controlFixture('<button id="forgotten" disabled>Download</button><input id="native-file" type="file">')), ['button#forgotten: Download', 'input#native-file: '], 'box sizing, UA controls and state-only rules do not supply a shared control appearance')
  assert.deepEqual(gaps(controlFixture('<button id="state-only" disabled>Action</button>'), `${STUDIO_WORKSPACE_CSS}\nbutton:disabled,button:focus-visible{font:inherit;padding:8px;background:red}`), ['button#state-only: Action'], 'disabled/focus-only declarations cannot mask a missing base style')
  assert.deepEqual(gaps(controlFixture('<input id="file" type="file">'), `${STUDIO_WORKSPACE_CSS}\ninput[type=file]::file-selector-button{font:inherit;padding:6px;border:1px solid gray}`), [], 'a real file-selector-button author rule covers the native picker')
  assert.deepEqual(gaps(controlFixture('<input type="file" hidden><button class="ygd-studio-btn-secondary">Choose archive</button>')), [], 'a hidden native picker leaves the visible trigger subject to coverage')
  assert.deepEqual(gaps(controlFixture(`<button class="ygd-studio-btn-secondary">Studio action</button>${foreignContent.split(', ').map(selector => `<div class="${selector.slice(1)}"><button>Foreign button</button><input type="file"></div>`).join('')}<iframe srcdoc="&lt;button&gt;User page&lt;/button&gt;"></iframe>`)), [], 'embedded Panels, previews and reading HTML retain their own control owners')
  assert.deepEqual(gaps(controlFixture('<section class="ygd-studio-trial-result"><button>Studio footer</button></section>')), ['button: Studio footer'], 'Studio-owned trial footer actions are not excluded with the foreign iframe')
})

// Keep legacy presentation assertions intact and independently selectable.
test('Studio feedback style coverage detects bare diagnostics and ineffective style declarations', t => {
  const { JSDOM } = createRequire(new URL('../../panel/package.json', import.meta.url))('jsdom')
  const dom = new JSDOM(''); t.after(() => dom.window.close())
  const gaps = (body, css = STUDIO_WORKSPACE_CSS) => feedbackStyleGaps(new dom.window.DOMParser().parseFromString(`<section class="ygd-studio-workspace">${body}</section>`, 'text/html'), css)
  assert.deepEqual(gaps('<p role="alert">Invalid source</p><p role="status">Cannot save</p>'), ['p[role=alert]: Invalid source', 'p[role=status]: Cannot save'], 'the reported AI candidate failure must not evade coverage')
  assert.deepEqual(gaps('<p role="alert" class="forgotten" style="color:red;padding:8px">Invalid source</p>'), ['p[role=alert]: Invalid source'], 'inline cosmetics and a class without a matching owned rule do not establish shared feedback')
  assert.deepEqual(gaps('<p role="alert" class="ygd-studio-error">Import failed</p><p role="status" class="ygd-studio-feedback">Imported</p>'), [], 'existing shared feedback rules supply explicit typography and spacing')
  assert.deepEqual(gaps('<p role="alert" class="notice">Failure</p>', '.wrong-host .notice{font:inherit;padding:8px}.notice:hover{font:inherit;padding:8px}'), ['p[role=alert]: Failure'], 'wrong host ancestors and hover-only rules cannot hide the gap')
  assert.deepEqual(gaps('<div class="ygd-studio-live-pane-body"><p role="alert">Preview failed</p></div>'), ['p[role=alert]: Preview failed'], 'the Studio preview wrapper does not hide its own error from feedback checks')
  assert.deepEqual(gaps('<div hidden><p role="alert">Hidden</p></div><div class="ygd-studio-markdown"><p role="status">Authored document</p></div>'), [])
})

test('Studio catalog and source presentation baseline', async () => {
// Installed sources share one identity card; explicit copies retain their own card.
{
  const reads = [], versions = ['1.9', '1.10']
  const historyClient = { ...client,
    workspace: async () => ({ query: '', kits: versions.map(version => ({ name: 'web_app', version })),
      bundles: [...versions.map(version => ({ name: 'questions', version, description, usedBy: [{ name: 'web_app', version }] })),
        { name: 'questions_fork', version: '1.0', description: 'independent fork', usedBy: [] }] }),
    readKitWorkspace: async (name, version) => {
      reads.push(['kit', name, version]); return { workspace: { ...kitWorkspace, name, version }, diagnostics: [] }
    },
    readBundleWorkspace: async (name, version) => {
      reads.push(['bundle', name, version]); return { workspace: { ...bundleWorkspace, name, version }, diagnostics: [] }
    },
  }
  const history = new StudioWorkspaceController(historyClient)
  await history.load()
  const markup = () => renderToStaticMarkup(createElement(StudioWorkspace, { client: historyClient, controller: history }))
  assert.equal((markup().match(/class="ygd-studio-kit-card ygd-studio-library-card"/g) ?? []).length, 1)
  await history.selectKit('web_app', '1.9')
  assert.doesNotMatch(markup(), /aria-label="Kit version"/)
  history.setSection('bundles')
  assert.equal((markup().match(/class="ygd-studio-kit-card ygd-studio-bundle-card"/g) ?? []).length, 2)
  assert.match(markup(), /2 Bundles/, 'the counter counts identities, not version cards')
  await history.openBundleWorkspace('questions', '1.9')
  assert.doesNotMatch(markup(), /aria-label="Bundle version"/)
  await history.openBundleWorkspace('questions', '1.10')
  assert.deepEqual(reads.at(-1), ['bundle', 'questions', '1.10'], 'history selection asks for the exact version')
  assert.equal(history.getSnapshot().bundleWorkspace.version, '1.10')
}

let html = render()
const sharedCss = html.match(/<style>([\s\S]*?)<\/style>/)?.[1].replaceAll('&gt;', '>') ?? ''


assert.match(sharedCss, /\.ygd-studio-content-header\{[^}]*min-height:48px;padding:8px 20px/, 'every Studio page shares the compact title-row baseline')
assert.match(sharedCss, /\.ygd-studio-header-title-group\{[^}]*min-height:32px;min-width:0/, 'the title group retains a readable 32px row without fixed-height clipping')
assert.match(sharedCss, /\.ygd-studio-header-title-group>\.ygd-studio-kitmark\{[^}]*width:32px;height:32px/, 'Kit, Bundle and local-copy title icons share one size')
assert.match(sharedCss, /\.ygd-studio-page-title\{[^}]*font-weight:500;font-size:18px;line-height:24px[^}]*overflow-wrap:anywhere/, 'long bilingual titles wrap using the shared heading scale')
assert.doesNotMatch(sharedCss, /\.ygd-studio-bundle-main \.ygd-studio-(?:page-title|header-title-group)[{>]/, 'Bundle pages do not own a competing title-size rule')
assert.doesNotMatch(html, />Duplicate<|>Rename<|>Delete</, 'installed cards do not advertise unavailable instance mutations')
assert.doesNotMatch(html, /ygd-studio-global-nav/, 'the sidebar owns navigation, so no separate top bar renders')
assert.match(html, /ygd-studio-sidebar-logo">Yugoo Design</, 'the sidebar carries the product identity')
assert.match(html, /ygd-studio-topbar/, 'the compact Studio context and refresh bar renders')
assert.match(html, /aria-label="Studio sections"/, 'the sidebar nav is a labeled landmark')
assert.match(html, /ygd-studio-sidebar-item"[^>]*aria-current="page"[^>]*>[\s\S]*?Kits<\/button>/)
assert.doesNotMatch(html, /Studio 1\.0 · Kits/, 'the content header carries the page context label')
assert.doesNotMatch(html, /ygd-studio-readonly-badge">Read-only</, 'installed status stays in content metadata, not a title badge')
assert.match(html, /aria-label="Installed Kits"/, 'the Kits grid is the entry point')
assert.match(html, /href="https:\/\/github\.com\/alibaba-damo-academy\/yugoo-design\/blob\/main\/docs\/wiki\/kit-sharing\.md#official-kits" target="_blank" rel="noopener noreferrer"/, 'official Kit discovery opens the maintained public guide without replacing Studio')
assert.match(html, />Browse official kits<svg/, 'the catalog guide is a secondary action, not another navigation section')
assert.match(html, /aria-label="Browse official kits: descriptions and acquisition guidance \(opens in a new tab\)"/, 'the visible action name and external navigation are announced')
assert.match(renderToStaticMarkup(createElement(StudioWorkspace, { client, controller, locale: 'zh' })), />浏览官方设计套件<svg/, 'the discovery link follows the shared UI language')
assert.match(sharedCss, /\.ygd-studio-content-header \.ygd-studio-catalog-link\{[^}]*min-height:32px;[^}]*margin:0 0 0 auto/, 'the guide link shares the compact title baseline')
assert.match(sharedCss, /\.ygd-studio-content-header \.ygd-studio-catalog-link\{[^}]*color:var\(--ds-primary-dark\)/, 'the small catalog text uses the accessible dark brand color')
assert.match(sharedCss, /\.ygd-studio-content-header \.ygd-studio-btn-primary,\.ygd-studio-content-header \.ygd-studio-btn-link\{margin:0\}\s*\.ygd-studio-content-header \.ygd-studio-catalog-link\{/, 'the catalog action alignment follows the common margin reset')
assert.match(html, /ygd-studio-kit-card-name">Web App</, 'Kit cards lead with the Kit name')
assert.doesNotMatch(html, /ygd-studio-version-badge">Version 1\.0</, 'internal pins do not crowd the title')
assert.match(html, /1 bundles/, 'the card retains a compact bundle count')
assert.match(html, /ygd-studio-card-description"><div class="ygd-studio-markdown"><p>Bilingual Kit introduction/, 'Kit cards use real localized display copy')
assert.match(html, /\.ygd-studio-kit-card\{[^}]*padding:15px;[^}]*gap:0;/, 'Kit, Bundle and local-copy cards share compact spacing')
assert.match(html, /\.ygd-studio-kit-card-name\{[^}]*font-size:15px;/, 'catalog titles share the same type scale')
assert.doesNotMatch(html, /\.ygd-studio-library-card[^}]*\{[^}]*font-size:18px|\.ygd-studio-library-card\{padding:/, 'Kits do not override shared density')
assert.match(html, /class="ygd-studio-btn-secondary" type="button">Open<\/button>/, 'Open uses the shared neutral action without an arrow')
assert.doesNotMatch(html, />Open →</)
assert.match(html, /--ds-primary:#7c5af6/, 'the stylesheet uses the Yugoo purple brand accent, not its text color')
assert.match(html, /--ds-primary-dark:#6849d8;--ds-primary-active:#5032bc/, 'brand interaction states follow Yugoo')
assert.match(html, /height:34px;min-height:34px/, 'search has a bounded compact height')
assert.match(html, /height:100%/, 'the standalone workspace fills its owning page while each pane scrolls independently')
assert.match(html, /@media\(max-width:1023px\)/, 'the responsive sidebar drawer ships with the surface')
assert.match(html, /class="ygd-studio-catalog-tools"[^>]*>[\s\S]*?type="search"/, 'Kit search stays in the shared left-hand catalog tools')
assert.doesNotMatch(html, /ygd-studio-nav-link/, 'section links exist only in the sidebar')
assert.doesNotMatch(html, /Test Lab/, 'the deferred Test Lab has no entry, not even a placeholder')
console.log('the entry surface follows the demo navigation and card structure')

await controller.selectKit('web_app', '1.0')
html = render()
assert.doesNotMatch(html, /class="ygd-studio-btn-link ygd-studio-catalog-link"/, 'the discovery link stays in the Kit list, not every detail page')
assert.match(html, /aria-label="Breadcrumb"/, 'the Kit Workspace opens with a breadcrumb')
assert.match(html, /Installed · read-only/, 'installed detail explicitly identifies its read-only base')
assert.doesNotMatch(html, />Duplicate<|>Rename<|>Delete</, 'installed details have no inert instance controls')
assert.match(html, /aria-label="Breadcrumb"/, 'only the top bar supplies navigation context')
assert.doesNotMatch(html, /Studio 1\.0 · Kit Workspace/)
assert.match(html, /role="tablist"/, 'second-level navigation is an explicit tablist')
assert.match(html, /class="ygd-studio-workplane-bar" role="tablist"/, 'the tablist uses the workplane styling')
assert.match(html, /role="tab" id="ygd-studio-tab-mindset" aria-selected="true" aria-controls="ygd-studio-kit-tabpanel"/)
assert.match(html, /role="tab" id="ygd-studio-tab-mounts" aria-selected="false"/)
assert.doesNotMatch(html, /role="tab" id="ygd-studio-tab-relations"/, 'KAG is not part of this Studio navigation')
assert.match(html, /role="tabpanel" id="ygd-studio-kit-tabpanel" aria-labelledby="ygd-studio-tab-mindset"/)
assert.match(html, /class="ygd-studio-content-body ygd-studio-kit-files-body"/, 'Kit files bypass the list padding so the shared file shell matches Bundle width')
assert.match(html, /\.ygd-studio-kit-files-body\{padding:0;overflow:hidden\}/, 'only the Kit file container removes its duplicate inset')
assert.match(html, />Source</, 'the complete source view is one toggle away')
assert.match(html, /ygd-studio-file-tree-pane/, 'Kit files use the shared split-pane explorer')
assert.match(html, /ygd-studio-file-info[\s\S]*About This Kit[\s\S]*Bilingual Kit introduction/, 'the file sidebar shows the complete Kit introduction')
assert.match(html, /ygd-studio-file-heading[\s\S]*title="Design mindset:[^"]+"[^>]*>mindset\.md/, 'standard file purpose is available on filename hover')
assert.match(html, new RegExp(`${new TextEncoder().encode(source).length} bytes`), 'size moves to the document footer')
const mindsetMetadata = html.match(/<details class="ygd-studio-file-metadata"([^>]*)>([\s\S]*?)<\/details>/)
assert.ok(mindsetMetadata, 'Mindset metadata remains available in a separate disclosure')
assert.doesNotMatch(mindsetMetadata[1], /\bopen(?:=|\s|$)/, 'metadata starts folded instead of preceding the document as visible YAML')
assert.match(mindsetMetadata[2], /<pre class="ygd-studio-frontmatter" aria-label="frontmatter">name: &quot;web_app&quot;\nversion: &quot;1.0&quot;<\/pre>/, 'metadata preserves the source text as escaped preformatted content')
const mindsetReadingBody = html.match(/<div aria-label="Kit document">([\s\S]*?)<footer class="ygd-studio-doc-footer">/)?.[1]
assert.equal(typeof mindsetReadingBody, 'string', 'the actual Kit file reader owns the Markdown body')
assert.match(mindsetReadingBody, /^<div class="ygd-studio-markdown"><h1>Web App<\/h1>/, 'Mindset reading view leads with the body')
assert.doesNotMatch(mindsetReadingBody, /name: &quot;web_app&quot;|version: &quot;1.0&quot;|ygd-studio-frontmatter/, 'metadata is not duplicated into the rendered Markdown body')
assert.match(html, /ygd-studio-markdown/, 'the mindset body renders as rich text by default')
assert.match(html, /<h1>Web App<\/h1>/, 'markdown headings render with hierarchy')
assert.equal((html.match(/<table>/g) ?? []).length, 2, 'pipe tables render, but fenced examples and invalid delimiters remain text')
assert.match(html, /<th scope="col" style="text-align:left">Current <strong>evidence<\/strong><\/th>/, 'table headers retain inline formatting and alignment')
assert.match(html, /<th scope="col" style="text-align:center">Candidate<\/th>/, 'center alignment follows the delimiter')
assert.match(html, /<th scope="col" style="text-align:right">Do not infer<\/th>/, 'right alignment follows the delimiter')
assert.match(html, /<td style="text-align:left">A \| B<\/td>/, 'escaped pipes stay in the same cell')
assert.match(html, /<td style="text-align:center"><code>research<\/code><\/td>/, 'inline code remains readable inside a table')
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'table content is rendered as escaped text')
assert.doesNotMatch(html, /<img src=x/, 'table cells cannot inject HTML')
assert.match(html, /<td style="text-align:right"><\/td>/, 'missing trailing cells render as empty cells')
assert.match(html, /<th scope="col">Name<\/th>/, 'tables work without optional outer pipes')
assert.match(html, /<pre><code>\| Example \| Only \|/, 'fenced table examples remain code')
assert.match(html, /mindset\.md/, 'the complete Mindset is present in the file tree')
assert.equal(controller.getSnapshot().kitWorkspace.mindsetSource, source, 'reading projection never rewrites the source')
assert.doesNotMatch(html, /<textarea/, 'no editor exists anywhere on the read-only surface')
assert.doesNotMatch(html, />Save</, 'no Save control exists anywhere on the read-only surface')
assert.doesNotMatch(html, /[Ww]orking [Cc]opy/, 'no working-copy wording survives')
console.log('the Kit Workspace shows breadcrumb, workplane tabs, and rich/source mindset viewing')

controller.setKitTab('relations')
html = render()
assert.doesNotMatch(html, /KAG relation extensions|Vocabulary pin:|web_app:validates/, 'obsolete relation views cannot leak through stale controller state')

controller.setKitTab('mounts')
html = render()
assert.match(html, /role="tabpanel" id="ygd-studio-kit-tabpanel" aria-labelledby="ygd-studio-tab-mounts"/)
assert.match(html, /aria-label="Mounted Bundles"/)
assert.match(html, /ygd-studio-source-id" title="questions">questions</, 'the stable identifier stays separate from the display label')
assert.match(html, /ygd-studio-card-description"><div class="ygd-studio-markdown"><ul><li><strong>Capability<\/strong>: capture product intent\./, 'the mounts row renders the frontmatter description as Markdown')
assert.doesNotMatch(html, /\*\*Capability\*\*/, 'raw Markdown markers never reach the row')
assert.doesNotMatch(html, /Method body\./, 'the mounts row shows no Bundle body excerpt')
assert.match(html, /Mounted reference/, 'Kit cards show mount mode; exact pins remain in mount management')
assert.doesNotMatch(html, />Customize for Kit<|>Unmount<|>Mount Bundle</, 'unimplemented mount mutations are not presented as actions')
assert.match(html, />Open<\/button>/, 'mounted Bundle keeps the shared arrow-free Open action')
assert.doesNotMatch(html, /Resources: shared|shared\/reference\/a\.md \(4 bytes\)/, 'resource inventories never spill onto the mounts page')
console.log('the mounts workplane is a read-only bundle list that opens Bundle workspaces')

// The Bundle workspace overlays the Kit workspace and returns to it.
await controller.openBundleWorkspace('questions')
html = render()
assert.match(html, /aria-label="Breadcrumb"/, 'only the top bar supplies navigation context')
assert.match(html, /ygd-studio-breadcrumb-button"[^>]*>Web App</, 'the Bundle breadcrumb returns to its Kit workspace')
assert.doesNotMatch(html, /Studio 1\.0 · Bundle Workspace/)
assert.match(html, />Mount management</, 'mount access is consolidated into one action')
assert.match(html, /aria-label="Bundle source files"/, 'the file tree pane is a labeled landmark')
assert.match(html, /ygd-studio-tree-folder/, 'nested resources are real expandable folders')
assert.match(html, /title="reference\/examples\/method.md"/, 'deep resources retain their complete path')
assert.match(html, /ygd-studio-tree-label">method.md</, 'only the leaf filename is shown, with UI typography')
assert.match(html, /ygd-studio-file-tree-header">All Files/, 'file tree title includes a count')
assert.match(html, /ygd-studio-tree-node"[^>]*aria-current="true"[^>]*>[\s\S]*?SKILL\.md/, 'the first file opens selected')
assert.match(html, /aria-pressed="true"[^>]*>Read</, 'SKILL.md defaults to the rendered rich view')
assert.match(html, /ygd-studio-file-info[\s\S]*About This Bundle[\s\S]*Bilingual Bundle introduction/, 'Bundle file details use the same full-introduction sidebar')
assert.match(html, /<h1>questions<\/h1>/, 'the SKILL.md body renders as rich text')
assert.match(html, /<details class="ygd-studio-file-metadata"><summary>File metadata/, 'reading folds metadata without deleting it')
assert.match(html, /aria-current="page"[^>]*>[\s\S]*?Bundles<\/button>/, 'Bundle viewing highlights its navigation section')
assert.match(html, /aria-pressed="true"[^>]*>Source Files</, 'source files are the first selected Bundle tab')
assert.match(html, /aria-pressed="false"[^>]*>Panel Preview</, 'preview is a separate second tab')
assert.doesNotMatch(html, />questions Panel</, 'no fake Panel placeholder is presented as a preview')
assert.doesNotMatch(html, />Save</, 'the Bundle workspace has no Save control')
assert.doesNotMatch(html, /role="tablist"/, 'the Kit tabs are covered while the overlay is open')
console.log('the Bundle workspace is a two-pane file tree plus rich viewer with panel classification')

await controller.openBundleFile('skill.yaml')
html = render()
assert.match(html, /ygd-studio-line-numbers/, 'yaml files render in the line-numbered code viewer')
assert.match(html, /<pre class="ygd-studio-code-body" aria-label="Bundle file source">name: questions/, 'the code viewer is byte-exact and read-only')
assert.doesNotMatch(html, />Read</, 'yaml files are source-first without a rich toggle')
console.log('yaml files stay source-first in the line-numbered viewer')

controller.closeBundleWorkspace()
html = render()
assert.match(html, /role="tablist"/, 'closing the overlay restores the Kit workspace')
assert.match(html, /aria-label="Mounted Bundles"/, 'the Kit workspace returns on the section it was left on')
assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/g, ''), /[Dd]raft|[Rr]evision|[Pp]ublish/, 'read-only host has no authoring controls or wording')
console.log('the overlay closes back into the open Kit workspace')

// The top-level Bundles section is a searchable catalog opening the same workspace.
controller.setSection('bundles')
html = render()
assert.doesNotMatch(html, /Studio 1\.0 · Bundles/, 'the Bundles section carries its context label')
assert.match(html, /ygd-studio-search-input/, 'the Bundles list offers search')
assert.match(html, /aria-label="Catalog Bundles"/)
assert.match(html, /ygd-studio-kit-card-name">Questions</, 'catalog Bundle cards lead with the Bundle name')
assert.match(html, /ygd-studio-card-description"><div class="ygd-studio-markdown"><ul><li><strong>Capability<\/strong>/, 'the catalog card renders the Markdown description')
assert.match(html, /1 Kit/, 'cards show usage count; exact pins remain in mount management')
controller.setBundleQuery('absent')
html = render()
assert.match(html, /No matching Bundles\./, 'a non-matching search says so explicitly')
controller.setBundleQuery('')
await controller.openBundleWorkspace('questions')
html = render()
assert.match(html, /ygd-studio-breadcrumb-button"[^>]*>Bundles</, 'the overlay opened from the Bundles list returns to it')
controller.closeBundleWorkspace()
html = render()
assert.match(html, /aria-label="Catalog Bundles"/, 'closing the overlay returns to the Bundles list')
controller.setSection('kits')
console.log('the top-level Bundles section is a searchable catalog opening the same Bundle workspace')

// Opt-in authoring does not mutate on render or expose native Panel editing.
{
  const authoring = { client: { create: () => { throw new Error('must not create during render') } }, renderPreview: () => createElement('div') }
  await controller.openBundleWorkspace('questions')
  const nativeHtml = renderToStaticMarkup(createElement(StudioWorkspace, { client, controller, authoring }))
  const trials = { list: () => { throw new Error('must not fetch trials during server render') } }
  const trialHtml = renderToStaticMarkup(createElement(StudioWorkspace, { client, controller, trials }))
  assert.equal((trialHtml.match(/>Trial run<|>试运行</g) ?? []).length, 1, 'the title row owns the sole trial entry, also accessible from source files')
  assert.match(trialHtml, /ygd-studio-hero-actions[\s\S]*>Trial run</, 'trial launch is in the title actions')
  assert.doesNotMatch(trialHtml, /class="ygd-studio-preview-modes"/, 'there is no second-row preview/trial/editor mode toolbar')
  assert.match(trialHtml, /ygd-studio-trial-slot/, 'trial result belongs to the Bundle preview workplane')
  assert.doesNotMatch(trialHtml, /ygd-studio-trial-dialog/, 'trial is not a modal workspace')
  assert.match(nativeHtml, /<button[^>]*disabled=""[^>]*>Trial run</, 'without a host trial transport the entry is explicitly unavailable')
  assert.doesNotMatch(nativeHtml, /ygd-studio-sidebar-item[^>]*>Panel drafts<|ygd-studio-sidebar-item[^>]*>面板草稿</, 'draft storage does not add an extra navigation section')
  assert.doesNotMatch(nativeHtml, />Customize Panel<|>定制面板</)
  const declarativeClient = { ...client, readBundleWorkspace: async () => ({ workspace: { ...bundleWorkspace, panel: { kind: 'declarative' } }, diagnostics: [] }) }
  const editableController = new StudioWorkspaceController(declarativeClient)
  await editableController.load()
  await editableController.openBundleWorkspace('questions')
  const editableHtml = renderToStaticMarkup(createElement(StudioWorkspace, { client: declarativeClient, controller: editableController, authoring }))
  assert.doesNotMatch(editableHtml, />Customize Panel<|>定制面板</, 'Panel draft editing belongs inside preview, not an extra hero action')
  assert.doesNotMatch(renderToStaticMarkup(createElement(StudioWorkspace, { client: declarativeClient, controller: editableController })), />Customize Panel<|>定制面板</)
  controller.closeBundleWorkspace()
}

// An in-flight load announces itself with a compact status row.
{
  let releaseWorkspace
  const gatedClient = { ...client, workspace: () => new Promise((resolve) => { releaseWorkspace = () => void client.workspace('').then(resolve) }) }
  const gated = new StudioWorkspaceController(gatedClient)
  const pending = gated.load()
  const loadingHtml = renderToStaticMarkup(createElement(StudioWorkspace, { client: gatedClient, controller: gated }))
  assert.match(loadingHtml, /<div class="ygd-studio-loading" role="status" aria-label="Loading…"><span class="ygd-studio-spinner" aria-hidden="true"><\/span><\/div>/, 'an in-flight load shows an accessible spinner instead of static placeholder text')
  assert.match(loadingHtml, /@keyframes ygd-studio-progress/, 'loading uses the KAG-style indeterminate sweep')
  assert.match(loadingHtml, /\.ygd-studio-loading\{[^}]*align-items:center;justify-content:center;flex:1;/, 'loading fills and centers within its available workspace')
  assert.match(loadingHtml, /\.ygd-studio-installed-preview\{display:flex;flex-direction:column;/, 'installed previews give the shared loader the remaining region')
  assert.match(loadingHtml, /prefers-reduced-motion:reduce/, 'loading indicator respects reduced motion')
  releaseWorkspace()
  await pending
  console.log('in-flight loads show an accessible animated spinner')
}

// Visible copy follows the host locale; English is the fallback.
globalThis.document = { documentElement: { lang: 'zh-CN' } }
try {
  controller.backToList()
  html = renderToStaticMarkup(createElement(StudioWorkspace, { client, controller }))
  assert.match(html, /已安装套件/, 'card metadata follows the document language')
  assert.match(html, /中文套件简介/, 'the card introduction follows the document language')
  assert.match(html, /aria-label="搜索设计套件…"/, 'catalog search follows the current locale without restoring the removed subtitle')
  assert.match(html, />打开<\/button>/)
  await controller.selectKit('web_app', '1.0')
  html = renderToStaticMarkup(createElement(StudioWorkspace, { client, controller }))
  assert.match(html, /套件文件|Kit Files/, 'the Kit source tab uses the current locale')
  assert.match(html, />技能包 · 1</)
  assert.match(html, /ygd-studio-file-info[\s\S]*设计套件简介[\s\S]*中文套件简介/, 'the file sidebar follows the host language')
  assert.match(html, />原文</, 'the document toggle is localized')
  assert.match(html, /mindset\.md/, 'the full Mindset file is available from the shared explorer; browser checks its raw XML')
  assert.equal(controller.getSnapshot().kitWorkspace.mindsetSource, source, 'Kit file bytes are never translated or rewritten')
} finally {
  delete globalThis.document
}
console.log('visible UI copy follows the host locale while file content stays untouched')
controller.backToList()
globalThis.document = { documentElement: { lang: 'en' } }
try {
  const localized = renderToStaticMarkup(createElement(StudioWorkspace, { client, controller, locale: 'zh' }))
  assert.match(localized, /已安装套件/)
  assert.match(localized, /中文套件简介/)
  assert.match(localized, /aria-label="界面语言"/)
  assert.match(localized, /lang="zh-CN" aria-pressed="true"/)
  assert.doesNotMatch(localized, /Search Kits or Bundles/)
  controller.setSection('bundles')
  const catalog = renderToStaticMarkup(createElement(StudioWorkspace, { client, controller, locale: 'zh' }))
  assert.match(catalog, /placeholder="搜索技能包/)
} finally { delete globalThis.document }

console.log('DESIGN STUDIO UI RENDER OK')

{
  const translatedClient = { ...client, workspace: async () => {
    const view = await client.workspace()
    return { ...view, bundles: view.bundles.map(bundle => ({ ...bundle, title: { zh: '智能提问', en: 'Smart Questions' }, displayDescription: { zh: '澄清产品意图', en: 'Clarify product intent' } })) }
  } }
  const translated = new StudioWorkspaceController(translatedClient)
  await translated.load()
  translated.setSection('bundles')
  const renderLocale = locale => renderToStaticMarkup(createElement(StudioWorkspace, { client: translatedClient, controller: translated, locale }))
  assert.match(renderLocale('zh'), /ygd-studio-kit-card-name">智能提问</)
  assert.match(renderLocale('en'), /ygd-studio-kit-card-name">Smart Questions</)
  await translated.openBundleWorkspace('questions')
  for (const [locale, title] of [['zh', '智能提问'], ['en', 'Smart Questions']]) {
    const markup = renderLocale(locale)
    assert.ok(markup.includes(`<h1 class="ygd-studio-page-title">${title}</h1>`))
    assert.ok(markup.slice(markup.indexOf('aria-label="Breadcrumb"'), markup.indexOf('class="ygd-studio-topbar-actions"')).includes(title), 'breadcrumb uses the same localized title')
  }
  assert.equal(translated.getSnapshot().bundleWorkspace.name, 'questions', 'display language never renames the Bundle identity')
}



})
