import assert from 'node:assert/strict'
import ts from 'typescript'

export const UI_FONT_BROKER_SPECIFIER = 'design:canvas-ui-font-broker'

/** Apply only after the existing exact-input and original binary guards. */
export function transformUiFontLifecycle(result, { metadataSpecifier, regularSha256 }) {
  assert.match(metadataSpecifier, /^\.\/[^/]+\.js$/)
  assert.match(regularSha256, /^[a-f0-9]{64}$/)
  const source = ts.createSourceFile('metadata.js', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(source.parseDiagnostics.length, 0)
  const remove = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === '__designRegisterUiFont' ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(source) === '__designUiFontReady'))
  assert.equal(remove.length, 2, 'Exact legacy UI registration prefix')
  assert.ok(!result.code.includes('__designAcquireUiFont'), 'Managed facade identifier collision')
  const variables = source.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
  for (const name of ['__designRegularFontData', '__designCodeFontData']) {
    const declaration = variables.filter(node => node.name.getText(source) === name)
    assert.equal(declaration.length, 1, 'One shared font payload binding')
    assert.ok(ts.isStringLiteral(declaration[0].initializer) && declaration[0].initializer.text.startsWith('data:font/woff2;base64,'))
  }
  let code = result.code
  for (const node of remove.sort((a, b) => b.getStart(source) - a.getStart(source))) {
    code = code.slice(0, node.getStart(source)) + code.slice(node.end)
  }
  code = `import { acquireUiFont as __designAcquireUiFontLease } from ${JSON.stringify(UI_FONT_BROKER_SPECIFIER)};` + code +
    `\nexport function __designAcquireUiFont(document,owner){return __designAcquireUiFontLease(document,{family:"Assistant",source:'url("'+__designRegularFontData+'")',sha256:${JSON.stringify(regularSha256)},style:"normal",weight:"250 900",display:"swap"},owner);}`
  const index = ts.createSourceFile('index.js', result.indexCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(index.parseDiagnostics.length, 0)
  assert.ok(!result.indexCode.includes('acquireDesignUiFont'), 'Public facade identifier collision')
  const originalImports = index.statements.filter(ts.isImportDeclaration).filter(node => node.moduleSpecifier.text === metadataSpecifier)
  assert.ok(originalImports.length > 0, 'Facade metadata belongs to the actual upstream index graph')
  const indexCode = `export { __designAcquireUiFont as acquireDesignUiFont } from ${JSON.stringify(metadataSpecifier)};` + result.indexCode
  for (const [name, text] of [['metadata.js', code], ['index.js', indexCode]]) {
    assert.equal(ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0)
  }
  return { ...result, code, indexCode, receipt: { ...result.receipt, uiFaceRegistration: 'consumer-owned broker facade', uiImportTimeRegistrationRemoved: true } }
}
