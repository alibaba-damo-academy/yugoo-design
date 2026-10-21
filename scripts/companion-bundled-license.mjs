/** Narrow staging authority for known bundled ELK, bpmn, pako and DOMPurify materials; no license acceptance claim. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import fixtureNotices from './test-fixtures/fixture-notice-map.json' with { type: 'json' }

export const BUNDLED_LICENSE_PINS = Object.freeze({
  "bpmn-js-18.24.0/LICENSE": "5788cf8bd61481776cee1c943595525499a1355c045e9244f92e6c8092c06770",
  "bpmn-js-18.24.0/SOURCE.md": "efcb82985a4bc325ed4320c64910e5f0408a89f7a027493e66ba8192bc7e5c08",
  "elkjs-0.10.2/LICENSE.md": "89591d4578fb1ebd91501312a3d25f021bd865a2e436641c1cf7b1bc7e3c1617",
  "elkjs-0.10.2/SOURCE.md": "d58c5d5ff4cc9c18456e6379b9303e3e60f51dcd884e68be67a4b5eaa7989f64",
  "elkjs-0.10.2/NOTICE.md": "cf5ce01bb3b3b7974cfa296cd14c2be4de7f88ab67d7b911b0a402e382fb2701",
  "elkjs-0.10.2/DEPENDENCIES": "4e441b47d606b18cdd1937cbbe5d79f92ca72dfe5d56327f5e2c6ff35e42a558",
  "elkjs-0.10.2/graph-layout-worker.ts": "ec766700ef21f6464fde45ac217975cb9468815113159d3bf77156ed511ca523",
  "elkjs-0.10.2/release-source-binding.json": "581bc1cdf3beebcbb6373f1501bc267e6993ec0835b687aaf8adb0ea91a2b0ba",
  "elkjs-0.10.2/upstream-README.md": "5f01b86cacdaf3e9928e24bcddf4e91ca344b859831ed856d6fcba3a2c4a24ac",
  "elkjs-0.10.2/upstream-build.gradle": "36c74b36571d3fca2fb3b5df492314c1ed6ddd0eb982899a0b2791dfa9c435d4",
  "elkjs-0.10.2/upstream-ci.yml": "a38c88225333591436c479fcede470df46a409cf13fa8fafdefa048ae0455d4e",
  "index.json": "cd9738909fe24591e56a1ec00ac8f4402f28546b26ced393cc6866064aeca8f0",
  "provenance.json": "4d81a325a1918da1ad317722e74879e9b5c3b60de63fe496d3c0cadd46818a1d",
  "pako-2.0.3/LICENSE": "a04665b3b2de56c66730c1f720f528175739e4104f79073614aa611da1e85539",
  "pako-2.0.3/SOURCE.md": "1ea3abd9d996476bf16f20b14f72a339dac69b15fd3d9235b0800a8eb05d62a8",
  "pako-2.0.3/zlib-README": "d8b499598e43d755ea8918448128259ff01820c50d94d5a48c8883d0a594ddb1",
  "pako-1.0.11/LICENSE": "a04665b3b2de56c66730c1f720f528175739e4104f79073614aa611da1e85539",
  "pako-1.0.11/SOURCE.md": "8a5a9a98fb3ab31e406f4c52d5e26a3373ae418f9de5eacdebe45a8c0b7ec581",
  "pako-1.0.11/zlib-README": "d8b499598e43d755ea8918448128259ff01820c50d94d5a48c8883d0a594ddb1",
  "dompurify-3.4.16/LICENSE": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  "dompurify-3.4.16/LICENSE-MPL": "fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85",
  "dompurify-3.4.16/SOURCE.md": "e132ed46f92916593bab00f4c315510b4a239c2b1504fd1bed6d8bed436c7f54"
})
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export const LADYBUG_MATERIAL_DIRECTORY = 'ladybug-wasm-core-0.21.1'
export const LADYBUG_MATERIAL_FILES = Object.freeze([
  'BUILD-SOURCE.json', 'LICENSE', 'README.md', 'SOURCE.json',
  'source-materials/INDEX.json',
  'source-materials/fulltext-supplement/CRoaring-4.5.1.LICENSE',
  'source-materials/fulltext-supplement/SOURCES.json',
  'source-materials/fulltext-supplement/cpp-httplib-0.14.2.LICENSE',
  'source-materials/header-notices/INDEX.json',
  'source-materials/header-notices/antlr4_cypher-lexer.GENERATED.txt',
  'source-materials/header-notices/antlr4_cypher-parser.GENERATED.txt',
  'source-materials/header-notices/fast_float.NOTICE.txt',
  'source-materials/header-notices/httpfs-extension.LICENSE',
  'source-materials/header-notices/httpfs-httplib.NOTICE.txt',
  'source-materials/header-notices/roaring_bitmap.NOTICE.txt',
  ...['antlr4_runtime', 'brotli', 'fastpfor', 'lz4', 'mbedtls', 'miniz',
    'parquet', 're2', 'simsimd', 'snappy', 'thrift', 'yyjson', 'zstd']
    .map(name => `source-materials/third_party/${name}/LICENSE`),
  'source-materials/third_party/utf8proc/LICENSE.md',
])

/** Copy the selected source materials; this does not verify dependency licensing. */
export async function prepareLadybugLicenseMaterials(sourceRoot) {
  return Promise.all(LADYBUG_MATERIAL_FILES.map(async path => ({
    path,
    bytes: await regularMaterial(sourceRoot, `third-party/native/${LADYBUG_MATERIAL_DIRECTORY}/${path}`),
  })))
}

export async function copyLadybugLicenseMaterials(entries, targetRoot, directory = `licenses/${LADYBUG_MATERIAL_DIRECTORY}`) {
  assert.ok([`licenses/${LADYBUG_MATERIAL_DIRECTORY}`, `lib/third-party/${LADYBUG_MATERIAL_DIRECTORY}`].includes(directory), 'Unknown Ladybug material destination')
  assert.equal(entries.length, LADYBUG_MATERIAL_FILES.length, 'Incomplete Ladybug materials')
  const snapshot = entries.map(({ path, bytes }) => ({ path, bytes: Buffer.from(bytes) }))
  for (const [i, path] of LADYBUG_MATERIAL_FILES.entries()) assert.equal(snapshot[i].path, path, 'Unexpected Ladybug material')
  const destination = join(targetRoot, directory)
  await mkdir(dirname(destination), { recursive: true })
  await mkdir(destination) // exclusive: never replace or merge an existing material set
  for (const { path, bytes } of snapshot) {
    await mkdir(dirname(join(destination, path)), { recursive: true })
    await writeFile(join(destination, path), bytes, { flag: 'wx' })
  }
  return {
    scope: 'selected-official-ladybug-source-license-materials-only',
    assets: Object.fromEntries(snapshot.map(({ path, bytes }) => [`${directory}/${path}`, sha(bytes)])),
    completeBinaryInventoryVerified: false,
    releaseLicenseAcceptance: false,
  }
}

async function regularMaterial(root, path) {
  const parts = path.split('/')
  for (let i = 0; i < parts.length; i++) {
    const info = await lstat(join(root, ...parts.slice(0, i + 1)))
    assert.ok(i === parts.length - 1 ? info.isFile() : info.isDirectory(), `Non-regular license material: ${path}`)
  }
  return readFile(join(root, path))
}

export async function prepareBundledLicenseMaterials(sourceRoot) {
  const entries = []
  for (const [path, hash] of Object.entries(BUNDLED_LICENSE_PINS)) {
    const bytes = await regularMaterial(sourceRoot, `third-party/companion/${path}`)
    assert.equal(sha(bytes), hash, `Bundled license material hash mismatch: ${path}`)
    entries.push({ path, bytes })
  }
  const currentShim = await regularMaterial(sourceRoot, 'scripts/graph-layout-worker.ts')
  assert.equal(sha(currentShim), BUNDLED_LICENSE_PINS['elkjs-0.10.2/graph-layout-worker.ts'], 'Bundled ELK transformation source is stale')
  return entries
}

export async function copyBundledLicenseMaterials(entries, targetRoot) {
  const expected = Object.entries(BUNDLED_LICENSE_PINS)
  assert.equal(entries.length, expected.length, 'Incomplete bundled license materials')
  const snapshot = entries.map(({ path, bytes }) => ({ path, bytes: Buffer.from(bytes) }))
  // Validate the whole prepared set before creating or writing any output.
  for (const [i, [path, hash]] of expected.entries()) {
    assert.equal(snapshot[i].path, path)
    assert.equal(sha(snapshot[i].bytes), hash, `Prepared license material changed: ${path}`)
  }
  const destination = join(targetRoot, 'licenses/third-party')
  await mkdir(destination) // exclusive: never merge with or replace existing material
  for (const { path, bytes } of snapshot) {
    await mkdir(dirname(join(destination, path)), { recursive: true })
    await writeFile(join(destination, path), bytes, { flag: 'wx' })
  }
  return {
    scope: 'known-bundled-elk-bpmn-pako-and-dompurify-materials-only',
    assets: Object.fromEntries(expected.map(([path, hash]) => [`licenses/third-party/${path}`, hash])),
    completeBundledInventory: false,
    elkPreferredSourceCorrespondenceVerified: false,
    bpmnWatermarkRuntimeVerified: false,
    releaseLicenseAcceptance: false,
  }
}

/** Called on resolved build modules, rather than assuming root dependency ranges. */
export async function inspectBundledModuleLicense(id) {
  const normalized = id.replaceAll('\\', '/')
  const match = normalized.match(/^(.*\/node_modules\/(elkjs|bpmn-js|pako|dompurify))(?:\/|$)/u)
  if (!match) return null
  const [root, name] = match.slice(1)
  let authority = {
    elkjs: { version: '0.10.2', licenses: [['LICENSE.md', 'elkjs-0.10.2/LICENSE.md']] },
    'bpmn-js': { version: '18.24.0', licenses: [['LICENSE', 'bpmn-js-18.24.0/LICENSE']] },
    pako: { version: '2.0.3', licenses: [['LICENSE', 'pako-2.0.3/LICENSE'], ['lib/zlib/README', 'pako-2.0.3/zlib-README']] },
    dompurify: { version: '3.4.16', licenses: [['LICENSE', 'dompurify-3.4.16/LICENSE'], ['LICENSE-MPL', 'dompurify-3.4.16/LICENSE-MPL']] },
  }[name]
  const manifestBytes = await regularMaterial(root, 'package.json')
  const manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.name, name, 'Bundled module package identity mismatch')
  // Core's locked Git codec brings pako 1; the browser still uses pako 2.
  // Both exact inputs retain their own source attribution and original notices.
  if (name === 'pako' && manifest.version === '1.0.11') authority = {
    version: '1.0.11', licenses: [['LICENSE', 'pako-1.0.11/LICENSE'], ['lib/zlib/README', 'pako-1.0.11/zlib-README']],
  }
  assert.equal(manifest.version, authority.version, `Unreviewed bundled ${name} version`)
  const licenseFiles = {}
  for (const [path, pin] of authority.licenses) {
    const licenseBytes = await regularMaterial(root, path)
    assert.equal(sha(licenseBytes), BUNDLED_LICENSE_PINS[pin], `Bundled ${name} license bytes differ: ${path}`)
    licenseFiles[path] = { bytes: licenseBytes.length, sha256: sha(licenseBytes) }
  }
  return {
    root, name, version: manifest.version, manifestSha256: sha(manifestBytes),
    licenseSha256: licenseFiles[authority.licenses[0][0]].sha256,
    licenseFiles,
  }
}

// Existing materials for the fonts and SVG icons embedded in the browser payload.
export const BROWSER_LICENSE_MATERIALS = Object.freeze({
  'whiteboard-fonts/manifest.json': 'packages/panel/third-party/native/whiteboard-fonts/manifest.json',
  'whiteboard-fonts/licenses/source-han-sans-LICENSE.txt': 'packages/panel/third-party/native/whiteboard-fonts/licenses/source-han-sans-LICENSE.txt',
  'whiteboard-fonts/licenses/JetBrainsMono-OFL.txt': 'packages/panel/third-party/native/whiteboard-fonts/licenses/JetBrainsMono-OFL.txt',
  'bpmn-font-0.12.1/LICENSE': 'packages/panel/third-party/native/bpmn-font-0.12.1/LICENSE',
  'bpmn-font-0.12.1/SOURCE.md': 'packages/panel/third-party/native/bpmn-font-0.12.1/SOURCE.md',
  'lucide-react/LICENSE': 'packages/panel/third-party/lucide-react/LICENSE',
  'lucide-react/SOURCE.md': 'packages/panel/third-party/lucide-react/SOURCE.md',
})

export const BROWSER_LICENSE_NOTICE = `
Companion browser payload embeds Source Han Sans CN and JetBrains Mono original
fonts (SIL OFL 1.1); attribution and license texts: licenses/third-party/whiteboard-fonts/.
BPMN font 0.12.1 (SIL OFL 1.1): licenses/third-party/bpmn-font-0.12.1/.
Lucide React 0.562.0 SVG icons (ISC and retained Feather MIT notice): licenses/third-party/lucide-react/.
These third-party materials retain their original licenses.
`

export async function prepareBrowserLicenseMaterials(sourceRoot) {
  return Promise.all(Object.entries(BROWSER_LICENSE_MATERIALS).map(async ([path, source]) => ({
    path, bytes: await regularMaterial(sourceRoot, source),
  })))
}

export async function copyBrowserLicenseMaterials(entries, targetRoot) {
  const expected = Object.keys(BROWSER_LICENSE_MATERIALS)
  assert.deepEqual(entries.map(entry => entry.path), expected, 'Incomplete browser license materials')
  const assets = {}
  for (const { path, bytes } of entries) {
    const relativePath = `licenses/third-party/${path}`
    await mkdir(dirname(join(targetRoot, relativePath)), { recursive: true })
    await writeFile(join(targetRoot, relativePath), bytes, { flag: 'wx' })
    assets[relativePath] = sha(bytes)
  }
  return { scope: 'selected-browser-font-and-lucide-materials', assets }
}

// Original texts for the selected packages actually embedded in Companion JavaScript.
export const BUNDLED_JS_LICENSE_FILES = Object.freeze([
  "ws@8.22.0/LICENSE",
  "ws@8.22.0/SOURCE.json",
  "@deepseek-ai/cosmokit@1.8.5/LICENSE",
  "@deepseek-ai/cordis@4.0.4/LICENSE",
  "react@18.3.1/LICENSE",
  "react-dom@18.3.1/LICENSE",
  "yaml@2.9.1/LICENSE",
  "es-toolkit@1.52.0/LICENSE",
  "es-toolkit@1.52.0/NOTICE",
  "path-intersection@4.2.1/LICENSE",
  "path-intersection@4.2.1/NOTICE",
  "three@0.186.0/LICENSE",
  "d3-force-3d@3.0.6/LICENSE",
  "d3-binarytree@1.0.2/LICENSE",
  "d3-quadtree@3.0.1/LICENSE",
  "d3-octree@1.1.0/LICENSE",
  "ngraph.events@1.4.0/LICENSE",
  "ngraph.graph@20.1.2/LICENSE",
  "ngraph.forcelayout@3.3.1/LICENSE",
  "ngraph.merge@1.0.0/LICENSE",
  "ngraph.random@1.2.0/LICENSE",
  "lodash-es@4.18.1/LICENSE",
  "kapsule@1.16.3/LICENSE",
  "accessor-fn@1.5.3/LICENSE",
  "data-bind-mapper@1.0.3/LICENSE",
  "d3-scale-chromatic@3.1.0/LICENSE",
  "tinycolor2@1.6.0/LICENSE",
  "three-forcegraph@1.43.6/LICENSE",
  "@babel/runtime@7.29.7/LICENSE",
  "polished@4.3.1/LICENSE.md",
  "@tweenjs/tween.js@25.0.0/LICENSE",
  "float-tooltip@1.7.5/LICENSE",
  "three-render-objects@1.43.0/LICENSE",
  "3d-force-graph@1.80.0/LICENSE",
  "mermaid@11.17.2/LICENSE",
  "d3-shape@3.2.0/LICENSE",
  "layout-base@2.0.1/LICENSE",
  "cose-base@2.2.0/LICENSE",
  "khroma@2.1.0/license",
  "@mermaid-js/parser@1.2.1/LICENSE",
  "vscode-languageserver-types@3.17.5/License.txt",
  "vscode-jsonrpc@8.2.0/License.txt",
  "vscode-languageserver-protocol@3.17.5/License.txt",
  "marked@16.4.2/LICENSE.md",
  "ts-dedent@2.3.0/LICENSE",
  "@iconify/utils@3.1.7/license.txt",
  "classcat@5.0.5/LICENSE.md",
  "d3-drag@3.0.0/LICENSE",
  "d3-interpolate@3.0.1/LICENSE",
  "@xyflow/system@0.0.83/LICENSE",
  "use-sync-external-store@1.7.0/LICENSE",
  "zustand@4.5.7/LICENSE",
  "@xyflow/react@12.12.0/LICENSE",
  "comma-separated-tokens@2.0.3/license",
  "estree-util-is-identifier-name@3.0.0/license",
  "hast-util-whitespace@3.0.0/license",
  "property-information@7.2.0/license",
  "space-separated-tokens@2.0.2/license",
  "inline-style-parser@0.2.7/LICENSE",
  "style-to-object@1.0.14/LICENSE",
  "style-to-js@1.1.21/LICENSE",
  "unist-util-position@5.0.0/license",
  "unist-util-stringify-position@4.0.0/license",
  "vfile-message@4.0.3/license",
  "hast-util-to-jsx-runtime@2.3.6/license",
  "html-url-attributes@3.0.1/license",
  "mdast-util-to-string@4.0.0/license",
  "decode-named-character-reference@1.3.0/license",
  "micromark-util-chunked@2.0.1/license",
  "micromark-util-combine-extensions@2.0.1/license",
  "micromark-util-decode-numeric-character-reference@2.0.2/license",
  "micromark-util-normalize-identifier@2.0.1/license",
  "micromark-util-character@2.1.1/license",
  "micromark-util-sanitize-uri@2.0.1/license",
  "micromark-factory-space@2.1.0/license",
  "micromark@4.0.3/license",
  "micromark-util-edit-map@1.0.0/license",
  "micromark-util-classify-character@2.0.1/license",
  "micromark-util-resolve-all@2.0.1/license",
  "micromark-core-commonmark@2.0.4/license",
  "micromark-util-subtokenize@2.1.0/license",
  "micromark-factory-destination@2.0.1/license",
  "micromark-factory-label@2.0.1/license",
  "micromark-factory-title@2.0.1/license",
  "micromark-factory-whitespace@2.0.1/license",
  "micromark-util-html-tag-name@2.0.1/license",
  "micromark-util-decode-string@2.0.1/license",
  "mdast-util-from-markdown@2.0.3/license",
  "remark-parse@11.0.0/license",
  "mdast-util-to-hast@13.2.1/license",
  "trim-lines@3.0.1/license",
  "@ungap/structured-clone@1.4.0/LICENSE",
  "unist-util-is@6.0.1/license",
  "unist-util-visit-parents@6.0.2/license",
  "unist-util-visit@5.1.0/license",
  "remark-rehype@11.1.2/license",
  "bail@2.0.2/license",
  "extend@3.0.2/LICENSE",
  "is-plain-obj@4.1.0/license",
  "trough@2.2.0/license",
  "vfile@6.0.3/license",
  "unified@11.0.5/license",
  "react-markdown@10.1.0/license",
  "ccount@2.0.1/license",
  "escape-string-regexp@5.0.0/license",
  "mdast-util-find-and-replace@3.0.2/license",
  "mdast-util-gfm-autolink-literal@2.0.1/license",
  "mdast-util-gfm-footnote@2.1.0/license",
  "mdast-util-gfm-strikethrough@2.0.1/license",
  "markdown-table@3.0.4/license",
  "mdast-util-phrasing@4.1.0/license",
  "zwitch@2.0.4/license",
  "mdast-util-to-markdown@2.1.3/license",
  "longest-streak@3.1.0/license",
  "mdast-util-gfm-table@2.0.0/license",
  "mdast-util-gfm-task-list-item@2.0.0/license",
  "mdast-util-gfm@3.1.0/license",
  "micromark-extension-gfm-autolink-literal@2.1.0/license",
  "micromark-extension-gfm-footnote@2.1.0/license",
  "micromark-extension-gfm-strikethrough@2.1.0/license",
  "micromark-extension-gfm-table@2.1.2/license",
  "micromark-extension-gfm-task-list-item@2.1.0/license",
  "micromark-extension-gfm@3.0.0/license",
  "remark-gfm@4.0.1/license",
  "parse5@7.3.0/LICENSE",
  "entities@6.0.1/LICENSE",
  "clsx@2.1.1/license",
  "tailwind-merge@3.7.0/LICENSE.md",
  "@radix-ui/react-compose-refs@1.1.5/LICENSE",
  "@radix-ui/react-slot@1.3.3/LICENSE",
  "class-variance-authority@0.7.1/LICENSE",
  "@radix-ui/react-context@1.2.2/LICENSE",
  "@radix-ui/primitive@1.1.7/LICENSE",
  "@radix-ui/react-use-layout-effect@1.1.4/LICENSE",
  "@radix-ui/react-use-effect-event@0.0.5/LICENSE",
  "@radix-ui/react-use-controllable-state@1.2.6/LICENSE",
  "@radix-ui/react-use-size@1.1.4/LICENSE",
  "@radix-ui/react-presence@1.1.10/LICENSE",
  "@radix-ui/react-primitive@2.1.10/LICENSE",
  "@radix-ui/react-checkbox@1.3.11/LICENSE",
  "@radix-ui/react-icons@1.3.2/LICENSE",
  "@radix-ui/react-collection@1.1.15/LICENSE",
  "@radix-ui/react-id@1.1.4/LICENSE",
  "@radix-ui/react-use-callback-ref@1.1.4/LICENSE",
  "@radix-ui/react-direction@1.1.4/LICENSE",
  "@radix-ui/react-use-is-hydrated@0.1.3/LICENSE",
  "@radix-ui/react-roving-focus@1.1.19/LICENSE",
  "@radix-ui/react-radio-group@1.4.7/LICENSE",
  "@radix-ui/react-dismissable-layer@1.1.19/LICENSE",
  "@floating-ui/utils@0.2.12/LICENSE",
  "@floating-ui/core@1.8.0/LICENSE",
  "@floating-ui/dom@1.8.0/LICENSE",
  "@floating-ui/react-dom@2.1.9/LICENSE",
  "@radix-ui/react-popper@1.3.7/LICENSE",
  "@radix-ui/react-portal@1.1.17/LICENSE",
  "@radix-ui/react-visually-hidden@1.2.11/LICENSE",
  "@radix-ui/react-tooltip@1.2.16/LICENSE",
  "@radix-ui/number@1.1.3/LICENSE",
  "@radix-ui/react-focus-guards@1.1.6/LICENSE",
  "@radix-ui/react-focus-scope@1.1.16/LICENSE",
  "@radix-ui/react-use-previous@1.1.4/LICENSE",
  "aria-hidden@1.2.6/LICENSE",
  "tslib@2.8.1/LICENSE.txt",
  "use-callback-ref@1.3.3/LICENSE",
  "use-sidecar@1.1.3/LICENSE",
  "react-remove-scroll@2.7.2/LICENSE",
  "react-style-singleton@2.2.3/LICENSE",
  "@radix-ui/react-select@2.3.7/LICENSE",
  "mdast-util-newline-to-break@2.0.0/license",
  "remark-breaks@4.0.0/license",
  "hast-util-parse-selector@4.0.0/license",
  "hastscript@9.0.1/license",
  "vfile-location@5.0.3/license",
  "web-namespaces@2.0.1/license",
  "hast-util-from-parse5@8.0.3/license",
  "hast-util-to-parse5@8.0.1/license",
  "html-void-elements@3.0.0/license",
  "hast-util-raw@9.1.0/license",
  "rehype-raw@7.0.0/license",
  "recharts@3.5.1/LICENSE",
  "d3-path@3.1.0/LICENSE",
  "reselect@5.1.1/LICENSE",
  "redux@5.0.1/LICENSE.md",
  "immer@11.1.18/LICENSE",
  "redux-thunk@3.1.0/LICENSE.md",
  "@reduxjs/toolkit@2.13.0/LICENSE",
  "immer@10.2.0/LICENSE",
  "d3-array@3.2.4/LICENSE",
  "internmap@2.0.3/LICENSE",
  "d3-scale@4.0.2/LICENSE",
  "d3-format@3.1.2/LICENSE",
  "d3-time@3.1.0/LICENSE",
  "d3-time-format@4.1.0/LICENSE",
  "decimal.js-light@2.5.1/LICENCE.md",
  "react-is@19.3.0/LICENSE",
  "tiny-invariant@1.3.3/LICENSE",
  "@radix-ui/react-dialog@1.1.23/LICENSE",
  "react-hook-form@7.89.0/LICENSE",
  "@radix-ui/react-label@2.1.15/LICENSE",
  "@hookform/resolvers@5.9.1/LICENSE",
  "zod@4.6.5/LICENSE",
  "inherits-browser@0.1.0/LICENSE",
  "min-dash@5.1.0/LICENSE",
  "diagram-js@15.28.0/LICENSE",
  "tiny-svg@4.1.4/LICENSE",
  "domify@3.0.0/license",
  "min-dom@5.3.0/LICENSE",
  "ids@3.0.2/LICENSE",
  "didi@11.0.1/LICENSE",
  "object-refs@0.4.0/LICENSE",
  "moddle@8.2.1/LICENSE",
  "saxen@11.2.0/LICENSE",
  "moddle-xml@12.3.1/LICENSE",
  "bpmn-moddle@10.3.1/LICENSE",
  "preact@10.29.8/LICENSE",
  "htm@3.1.1/LICENSE",
  "diagram-js-direct-editing@3.6.0/LICENSE",
  "@radix-ui/react-tabs@1.1.21/LICENSE",
  "@radix-ui/react-menu@2.1.24/LICENSE",
  "@radix-ui/react-dropdown-menu@2.1.24/LICENSE",
  "crc-32@0.3.0/LICENSE",
  "png-chunks-extract@1.0.0/LICENSE.md",
  "png-chunk-text@1.0.0/LICENSE.md",
  "sliced@1.0.1/LICENSE",
  "png-chunks-encode@1.0.0/LICENSE.md",
  "open-color@1.9.1/LICENSE",
  "nanoid@3.3.3/LICENSE",
  "lodash.throttle@4.1.1/LICENSE",
  "es6-promise-pool@2.5.0/LICENSE",
  "hachure-fill@0.5.2/LICENSE",
  "roughjs@4.6.4/LICENSE",
  "path-data-parser@0.1.0/LICENSE",
  "points-on-curve@0.2.0/LICENSE",
  "points-on-path@0.2.1/LICENSE",
  "perfect-freehand@1.2.0/LICENSE",
  "clsx@1.1.1/license",
  "points-on-curve@1.0.1/LICENSE",
  "fractional-indexing@3.2.0/LICENSE",
  "jotai@2.11.0/LICENSE",
  "jotai-scope@0.7.2/LICENSE",
  "tunnel-rat@0.1.2/LICENSE",
  "@excalidraw/laser-pointer@1.3.1/LICENSE",
  "layout-base@1.0.2/LICENSE",
  "cose-base@1.0.3/LICENSE",
  "cytoscape@3.34.3/LICENSE",
  "dagre-d3-es@7.0.14/LICENSE.md",
  "d3-hierarchy@3.1.2/LICENSE",
  "@braintree/sanitize-url@7.1.2/LICENSE",
  "@excalidraw/mermaid-to-excalidraw@2.2.2/LICENSE",
  "nanoid@4.0.2/LICENSE",
  "stylis@4.4.0/LICENSE",
  "d3-color@3.1.0/LICENSE",
  "d3-axis@3.0.0/LICENSE",
  "dayjs@1.11.23/LICENSE",
  "image-blob-reduce@3.0.1/LICENSE",
  "katex@0.16.47/LICENSE",
  "uuid@14.0.2/LICENSE.md",
  "pica@7.1.1/LICENSE",
  "roughjs@4.6.6/LICENSE",
  "canvas-roundrect-polyfill@0.0.1/LICENSE",
  "d3-array@2.12.1/LICENSE",
  "d3-sankey@0.12.3/LICENSE",
  "d3-path@1.0.9/LICENSE",
  "d3-shape@1.3.7/LICENSE",
  "d3-brush@3.0.0/LICENSE",
  "d3-timer@3.0.1/LICENSE",
  "d3-transition@3.0.1/LICENSE",
  "d3-ease@3.0.1/LICENSE",
  "d3-zoom@3.0.0/LICENSE",
  "d3-dispatch@3.0.1/LICENSE",
  "d3-selection@3.0.0/LICENSE",
  "@upsetjs/venn.js@2.0.0/LICENSE",
  "@modelcontextprotocol/sdk@1.32.0/LICENSE",
  "zod-to-json-schema@3.25.2/LICENSE",
  "ajv@8.20.0/LICENSE",
  "fast-deep-equal@3.1.3/LICENSE",
  "json-schema-traverse@1.0.0/LICENSE",
  "fast-uri@3.1.8/LICENSE",
  "ajv-formats@3.0.1/LICENSE",
  "min-dash@4.2.3/LICENSE",
  "moddle@7.2.0/LICENSE",
  "saxen@10.0.0/LICENSE",
  "moddle-xml@11.0.0/LICENSE",
  "bpmn-moddle@9.0.4/LICENSE",
  "graceful-fs@4.2.11/LICENSE",
  "retry@0.12.0/License",
  "signal-exit@3.0.7/LICENSE.txt",
  "proper-lockfile@4.1.2/LICENSE",
  "rolldown@1.2.12/LICENSE",
  "rolldown@1.2.12/THIRD-PARTY-LICENSE",
  "rolldown@1.2.12/SOURCE.json",
  "emitted-originals-index.json",
  "cytoscape-fcose@2.2.0/LICENSE",
  "browser-fs-access@0.29.1/LICENSE",
  "devlop@1.1.0/license",
  "eventemitter3@5.0.4/LICENSE",
  "fuzzy@0.1.3/LICENSE-MIT",
  "get-nonce@1.0.1/LICENSE",
  "reselect@5.2.0/LICENSE",
  "cytoscape-cose-bilkent@4.1.0/LICENSE",
  "@excalidraw/markdown-to-text@0.1.2/LICENSE",
  "current-output-originals-index.json",
  "@excalidraw/excalidraw@0.18.1/LICENSE",
  "@excalidraw/excalidraw@0.18.1/SOURCE.json",
  "react-resizable-panels@3.0.6/LICENSE",
  "react-resizable-panels@3.0.6/SOURCE.json",
  "radix-primitives/SOURCE.json",
  "unresolved-originals.json",
  "fastdom@1.0.12/README-LICENSE.txt",
  "fastdom@1.0.12/SOURCE-HEADER.txt",
  "fastdom@1.0.12/ATTRIBUTION.md",
  "react-remove-scroll-bar@2.3.8/UPSTREAM-LICENSE-2.3.7.txt",
  "react-remove-scroll-bar@2.3.8/ATTRIBUTION.md",
  "victory-vendor@37.3.6/SOURCE.json",
  "victory-vendor@37.3.6/ATTRIBUTION.md",
  "victory-vendor@37.3.6/UPSTREAM-README.md",
  ...['d3-array', 'd3-color', 'd3-ease', 'd3-format', 'd3-interpolate',
    'd3-path', 'd3-scale', 'd3-shape', 'd3-time', 'd3-time-format',
    'd3-timer', 'd3-voronoi', 'internmap'].map(name => `victory-vendor@37.3.6/lib-vendor/${name}/LICENSE`)
])
export const BUNDLED_JS_LICENSE_NOTICE = `
Bundled JavaScript original licenses and notices: licenses/bundled-js/.
The native Codex notification transport uses ws 8.22.0 (MIT); original
LICENSE and source identity are in licenses/bundled-js/ws@8.22.0/.
Selected packages: @deepseek-ai/cosmokit 1.8.5, @deepseek-ai/cordis 4.0.4,
react and react-dom 18.3.1, yaml 2.9.1, es-toolkit 1.52.0, path-intersection 4.2.1.
Additional original texts and recorded prior-build member/package/version
correspondence: licenses/bundled-js/emitted-originals-index.json. Its member
locations retain historical observations; they do not verify the output names
or component associations of a later build.
The historical Flow rolldown runtime helper observation used rolldown 1.2.12;
its original LICENSE, THIRD-PARTY-LICENSE and bounded correspondence remain
in licenses/bundled-js/rolldown@1.2.12/. It does not identify a later build's
toolchain. The retained Pica runtime observation used rolldown 1.2.4; its
source correspondence and original texts are in licenses/bundled-js/pica-embedded/.
Pica's prebundled glur, inherits, multimath, object-assign and webworkify original
texts are also retained there. fixture-notice-map.json preserves the existing
repository source/notice correspondence unchanged; its pica-worker/source/
notice suffixes locate these packaged originals. Compared source versions do
not uniquely recover historical resolution, and fixture runtime results do
not establish execution of this package. Neither record is a complete inventory.
Excalidraw 0.18.1 and react-resizable-panels 3.0.6 original LICENSE/SOURCE.json
are in their versioned directories; Radix shared-license correspondence is in
radix-primitives/SOURCE.json. FastDom 1.0.12 target README license and source header
are retained in fastdom@1.0.12/. react-remove-scroll-bar 2.3.8 target MIT/author
attribution and unchanged shared upstream 2.3.7 LICENSE are retained in its
versioned directory. These two attribution records are in unresolved-originals.json.
Nine further components identified in the recorded normal browser/server outputs
retain original license texts and member correspondence in
licenses/bundled-js/current-output-originals-index.json. This records that build,
not complete component coverage or verification of a later archive.
These original third-party texts retain their own licenses.
victory-vendor 37.3.6 (package declares MIT AND ISC) attribution, original README
and thirteen original vendored LICENSE files are in victory-vendor@37.3.6/.
These preserve individual vendor terms and copyrights, not a generic template
or an assertion of complete rendered-vendor coverage.
`

export async function prepareBundledJsLicenseMaterials(sourceRoot) {
  const entries = await Promise.all(BUNDLED_JS_LICENSE_FILES.map(async path => ({
    path, bytes: await regularMaterial(sourceRoot, `third-party/companion/bundled-js/${path}`),
  })))
  return [...entries, ...await prepareEmbeddedPicaLicenseMaterials(sourceRoot)]
}

export async function copyBundledJsLicenseMaterials(entries, targetRoot) {
  assert.deepEqual(entries.map(entry => entry.path), [...BUNDLED_JS_LICENSE_FILES, ...embeddedPicaPaths], 'Incomplete selected bundled JavaScript materials')
  validateEmbeddedPicaEntries(entries.slice(BUNDLED_JS_LICENSE_FILES.length))
  return copyBundledJsEntries(entries, targetRoot)
}

// Reuse the reviewed fixture authority and original files: no second component
// list, copied source authority, or inferred complete prebundle inventory.
const fixtureMapPath = 'scripts/test-fixtures/fixture-notice-map.json'
const fixtureMapSha256 = 'd1ae011d9839b6447023bdc1ee869fd526b28d3d5c8cbd575256011a70c4f163'
const fixtureSourcePrefix = 'scripts/test-fixtures/pica-worker/source/'
const embeddedPicaSources = [...new Set(fixtureNotices.components
  .filter(item => Number.isInteger(item.moduleId) || item.name === 'rolldown')
  .flatMap(item => item.noticePaths ?? [item.noticePath]))]
  .map(source => {
    assert.ok(source.startsWith(fixtureSourcePrefix), 'Unknown Pica original source')
    const notice = fixtureNotices.noticeFiles.find(item => item.path === source)
    assert.ok(notice, 'Missing reviewed Pica notice identity')
    return { source, path: 'pica-embedded/' + source.slice(fixtureSourcePrefix.length), sha256: notice.sha256 }
  })
const embeddedPicaMaterials = [
  { source: fixtureMapPath, path: 'pica-embedded/fixture-notice-map.json', sha256: fixtureMapSha256 },
  ...embeddedPicaSources,
]
const embeddedPicaPaths = embeddedPicaMaterials.map(item => item.path)
export const EMBEDDED_PICA_LICENSE_SOURCE_PATHS = Object.freeze(embeddedPicaMaterials.map(item => item.source))

export async function prepareEmbeddedPicaLicenseMaterials(sourceRoot) {
  return Promise.all(embeddedPicaMaterials.map(async item => {
    const bytes = await regularMaterial(sourceRoot, item.source)
    assert.equal(sha(bytes), item.sha256, `Embedded Pica material changed: ${item.source}`)
    return { path: item.path, bytes }
  }))
}

function validateEmbeddedPicaEntries(entries) {
  assert.deepEqual(entries.map(item => item.path), embeddedPicaPaths, 'Incomplete embedded Pica materials')
  for (const [i, item] of entries.entries()) assert.equal(sha(item.bytes), embeddedPicaMaterials[i].sha256, `Prepared embedded Pica material changed: ${item.path}`)
}

export async function copyEmbeddedPicaLicenseMaterials(entries, targetRoot) {
  validateEmbeddedPicaEntries(entries)
  return copyBundledJsEntries(entries, targetRoot)
}

async function copyBundledJsEntries(entries, targetRoot) {
  const snapshot = entries.map(({ path, bytes }) => ({ path, bytes: Buffer.from(bytes) }))
  const assets = {}
  for (const { path, bytes } of snapshot) {
    const relativePath = `licenses/bundled-js/${path}`
    await mkdir(dirname(join(targetRoot, relativePath)), { recursive: true })
    await writeFile(join(targetRoot, relativePath), bytes, { flag: 'wx' })
    assets[relativePath] = sha(bytes)
  }
  return { scope: 'selected-emitted-javascript-original-materials', assets }
}
