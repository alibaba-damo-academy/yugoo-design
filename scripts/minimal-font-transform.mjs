import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import ts from 'typescript'

export const hash = value => createHash('sha256').update(value).digest('hex')
const roles = { Cascadia: 'code', 'Comic Shanns': 'code', Excalifont: 'regular', Helvetica: 'regular', 'Liberation Sans': 'regular', 'Lilita One': 'regular', Nunito: 'regular', Virgil: 'regular', Xiaolai: 'regular' }
export function transformMinimalFonts({ code, css, guards, fonts, mode = 'prod' }) {
  assert.equal(hash(code), guards.metadataSha256, 'Exact renderer metadata guard')
  assert.equal(hash(css), guards.cssSha256, 'Exact renderer CSS guard')
  for (const role of ['regular', 'code']) {
    const font = fonts[role]
    assert.equal(font.exportPolicy, 'embed-original', 'Export subsetting is deliberately disabled for this slice')
    assert.ok(Buffer.isBuffer(font.bytes) && font.bytes.length > 0)
    assert.equal(hash(font.bytes), font.sha256, 'Replacement byte identity')
    assert.equal(font.originalUnmodified, true, 'Only original unmodified font bytes supported')
    assert.ok(font.sourceCommit && font.licenseSha256 && font.displayName)
    assert.ok(font.metrics && [1000, 1024, 2048].includes(font.metrics.unitsPerEm))
    assert.ok(Number.isFinite(font.metrics.ascender) && font.metrics.ascender > 0)
    assert.ok(Number.isFinite(font.metrics.descender) && font.metrics.descender <= 0)
    assert.ok(Number.isFinite(font.metrics.lineHeight) && font.metrics.lineHeight >= 1 && font.metrics.lineHeight <= 2)
    assert.equal(font.coverage, role === 'regular' ? 'cjk-and-latin' : 'latin-monospace', 'Explicit coverage contract')
  }
  assert.ok(['prod','dev'].includes(mode));
  const dev=mode==='dev', b=dev?{family:'FONT_FAMILY',fallbacks:'FONT_FAMILY_FALLBACKS',metadata:'FONT_METADATA',registry:'_Fonts',init:'init',cjk:'CJK_HAND_DRAWN_FALLBACK_FONT',emoji:'WINDOWS_EMOJI_FALLBACK_FONT',fallback:'getFontFamilyFallbacks',local:'LOCAL_FONT_PROTOCOL',subset:'subsetWoff2GlyphsByCodepoints',pool:'PromisePool'}:{family:'Ie',fallbacks:'Un',metadata:'Fr',registry:'ne',init:'n',cjk:'Mn',emoji:'Tn',fallback:'bo',local:'Wn',subset:'qd',pool:'vr'};
  const urls = Object.fromEntries(Object.entries(fonts).map(([role,font]) => [role, 'data:font/woff2;base64,' + font.bytes.toString('base64')]))
  const source = ts.createSourceFile('metadata.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(source.parseDiagnostics.length, 0)
  const declarations = new Map(), methods = [], edits = [], bindings = {}
  const add = (node, value) => edits.push({ start: node.getStart(source), end: node.end, value })
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node)
    if (ts.isMethodDeclaration(node)) methods.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(!declarations.has('__designRegularFontData') && !declarations.has('__designCodeFontData'), 'Shared data identifier collision')
  // Hash-guarded upstream identifiers are also matched by their semantic shapes.
  for (const [name, required] of Object.entries({ [b.family]: ['Virgil','Helvetica','Cascadia','Excalifont','Nunito','Lilita One','Comic Shanns','Liberation Sans'], [b.fallbacks]: null, [b.metadata]: null })) {
    const node = declarations.get(name)
    assert.ok(node && ts.isObjectLiteralExpression(node.initializer), 'Required family/metadata object: ' + name)
    if (required) assert.deepEqual(node.initializer.properties.map(p => p.name.text), required)
    bindings[name] = node.initializer.getText(source)
  }
  let oldUriCount = 0
  for (const node of declarations.values()) {
    if (ts.isStringLiteral(node.initializer) && node.initializer.text.startsWith('./fonts/')) {
      oldUriCount++; add(node.initializer, '""')
    }
  }
  assert.equal(oldUriCount, 230, 'Every old scene font URI declaration must be removed')
  const init = methods.filter(m => m.name.getText(source) === 'init' && m.body?.getText(source).includes(b.registry+'.register.call'))
  assert.equal(init.length, 1, 'Exact registry initializer')
  const registrations = []
  function readCalls(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === b.init) {
      const [family, spread] = node.arguments
      const familyName = ts.isStringLiteral(family) ? family.text : { [b.cjk]:'Xiaolai', [b.emoji]:'Segoe UI Emoji' }[family.getText(source)]
      assert.ok(familyName && spread && ts.isSpreadElement(spread))
      registrations.push({ family: familyName, array: spread.expression.getText(source) })
    }
    ts.forEachChild(node, readCalls)
  }
  readCalls(init[0].body)
  assert.deepEqual(registrations.map(r => r.family), ['Cascadia','Comic Shanns','Excalifont','Helvetica','Liberation Sans','Lilita One','Nunito','Virgil','Xiaolai','Segoe UI Emoji'])
  for (const { family, array } of registrations) {
    if (family === 'Segoe UI Emoji') continue // local system emoji stays local; no bundled asset
    const role = roles[family], node = declarations.get(array)
    assert.ok(node && ts.isArrayLiteralExpression(node.initializer), 'Font descriptor array')
    add(node.initializer, `[{uri:${role === 'regular' ? '__designRegularFontData' : '__designCodeFontData'},descriptors:{unicodeRange:"U+0-10FFFF",weight:"400",style:"normal"}}]`)
  }
  const metricsNode = declarations.get(b.metadata).initializer
  assert.equal(metricsNode.properties.length, 10)
  for (const property of metricsNode.properties) {
    assert.ok(ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer))
    const key = property.name.getText(source)
    const expression = property.name.expression
    const family = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : undefined
    if (family === 'Segoe UI Emoji') continue
    const role = roles[family]; assert.ok(role, 'Known metric family: ' + key)
    const metric = property.initializer.properties.find(p => p.name?.getText(source) === 'metrics')
    assert.ok(metric)
    add(metric.initializer, JSON.stringify(fonts[role].metrics))
    // Browser local/server-only flags are invalid once this ID has a bundled replacement.
    for (const field of property.initializer.properties) {
      if (['local','serverSide'].includes(field.name?.getText(source))) add(field.initializer, 'false')
    }
  }
  const fallback = declarations.get(b.fallback); assert.ok(fallback && ts.isArrowFunction(fallback.initializer))
  assert.ok(fallback.initializer.getText(source).includes(b.family+'.Excalifont'))
  add(fallback.initializer, `e=>[${b.cjk},${b.emoji}]`) // all text roles get CJK + local emoji fallback
  const exportMethod = methods.filter(m => m.name.getText(source) === 'generateFontFaceDeclarations')
  assert.equal(exportMethod.length, 1)
  assert.ok(exportMethod[0].body.getText(source).includes(b.registry+'.fontFacesStylesGenerator'))
  add(exportMethod[0].body, `{let n=${b.registry}.getUniqueFamilies(${exportMethod[0].parameters[0].name.getText(source)}),r=${b.registry}.getCharsPerFamily(${exportMethod[0].parameters[0].name.getText(source)}),chars=new Set;for(const family of n){if(family===${b.fallbacks}[${b.cjk}])continue;for(const ch of ${b.registry}.getCharacters(r,family))chars.add(ch)}if(chars.size){r[${b.fallbacks}[${b.cjk}]]=chars;n.unshift(${b.fallbacks}[${b.cjk}])}let i=${b.registry}.fontFacesStylesGenerator(n,r),s=await new ${b.pool}(i,3).all();return Array.from(new Set(s))}`)
  const contents = methods.filter(m => m.name.getText(source) === 'getContent' && m.body?.getText(source).includes(b.subset+'('))
  assert.equal(contents.length, 1)
  // Embed unchanged source bytes; no runtime font modifications or RFN rename assumptions.
  add(contents[0].body, '{if(this.urls.length!==1||typeof this.urls[0]!=="string"||!this.urls[0].startsWith("data:font/woff2;base64,"))throw Error("Unverified replacement font export source");return this.urls[0]}')
  const urlsMethod = methods.filter(m => m.name.getText(source) === 'createUrls' && m.body?.getText(source).includes('ASSETS_FALLBACK_URL'))
  assert.equal(urlsMethod.length, 1)
  add(urlsMethod[0].body, `{const uriValue=${urlsMethod[0].parameters[0].name.getText(source)};if(uriValue.startsWith("data:font/woff2;base64,"))return[uriValue];if(uriValue.startsWith(${b.local}))return[];throw Error("Unverified replacement font URL")}`)
  const fallbackUrl = 'https://esm.sh/'
  let esmRemoved = 0
  function removeEsm(node) {
    if (ts.isTemplateExpression(node) && node.head.text.startsWith(fallbackUrl)) { esmRemoved++; add(node, '""'); return }
    ts.forEachChild(node, removeEsm)
  }
  removeEsm(source); assert.equal(esmRemoved, 1)
  const sorted = edits.sort((a,b)=>b.start-a.start)
  for (let i=1;i<sorted.length;i++) assert.ok(sorted[i].end <= sorted[i-1].start, 'Nonoverlapping semantic edits')
  let output = code
  for (const edit of sorted) output=output.slice(0,edit.start)+edit.value+output.slice(edit.end)
  output = `const __designRegularFontData=${JSON.stringify(urls.regular)};const __designCodeFontData=${JSON.stringify(urls.code)};function __designRegisterUiFont(retried=false){if(typeof document==="undefined"||typeof FontFace==="undefined")return Promise.resolve(false);let face;const failed=error=>{if(face){try{document.fonts.delete(face)}catch(cleanupError){}}if(!retried)return __designRegisterUiFont(true);try{console.error("Whiteboard UI replacement font failed to load",error)}catch(reportError){}return false};try{face=new FontFace("Assistant","url("+__designRegularFontData+")",{style:"normal",weight:"250 900",display:"swap"});document.fonts.add(face);return Promise.resolve(face.load()).then(()=>true,failed)}catch(error){return Promise.resolve(failed(error))}}const __designUiFontReady=__designRegisterUiFont();` + output
  assert.equal(ts.createSourceFile('out.js',output,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0)
  const literals=ts.createSourceFile('out.js',output,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let oldLiteral=false;function check(n){if(ts.isStringLiteral(n)&&n.text.startsWith('./fonts/'))oldLiteral=true;ts.forEachChild(n,check)}check(literals);
  assert.ok(!oldLiteral && !output.includes('https://esm.sh/'))
  let cssCount = 0
  const outputCss = css.replace(/@font-face\s*\{\s*font-family:\s*(?:Assistant|"Assistant");[^}]*\}/g, block => {
    assert.ok(/src:\s*url\(["']\.\/fonts\/Assistant\/[^"']+\.woff2["']\)/.test(block), 'Exact Assistant font-face')
    cssCount++; return ''
  })
  assert.equal(cssCount,4)
  return { code: output, css: outputCss, receipt: { oldUriCount, cssCount, legacyIdsUnchanged: true, roleCount: 2, exportPolicy: 'embed-original', sharedJsPayloads: 2, cssPayloads: 0, uiFaceRegistration: 'browser-guarded variable Assistant alias', syntheticOrRealBytesNotDeterminedByTransform: true, bindings, registrations, requiredNextGate: 'original binary licenses/metrics/coverage and browser/export/package verification' } }
}
