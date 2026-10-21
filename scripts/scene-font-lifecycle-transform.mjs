import assert from 'node:assert/strict'
import ts from 'typescript'
export const SCENE_FONT_BROKER_SPECIFIER='design:canvas-scene-font-broker'
/** Called after original-input guards and the UI lifecycle transform. */
export function transformSceneFontLifecycle(result,{mode}) {
 assert.ok(['prod','dev'].includes(mode))
 const registry=mode==='dev'?'_Fonts':'ne',pool=mode==='dev'?'PromisePool':'vr'
 const source=ts.createSourceFile('metadata.js',result.code,ts.ScriptTarget.Latest,true)
 assert.equal(source.parseDiagnostics.length,0)
 const methods=[],functions=[];function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(source)==='loadFontFaces')methods.push(n);if(ts.isFunctionDeclaration(n)&&n.name?.text==='__designAcquireUiFont')functions.push(n);ts.forEachChild(n,walk)}walk(source)
 assert.equal(methods.length,1);assert.equal(functions.length,1)
 const method=methods[0],body=method.body,first=body.statements[0],last=body.statements.at(-1)
 assert.ok(ts.isForOfStatement(first)&&first.expression.getText(source)===registry+'.registered.values()','Exact upstream scene registration loop')
 const descendants=[];function collect(n){descendants.push(n);ts.forEachChild(n,collect)}collect(first)
 assert.equal(descendants.filter(n=>ts.isPropertyAccessExpression(n)&&n.name.text==='local').length,1,'Exact local exclusion')
 assert.equal(descendants.filter(n=>ts.isCallExpression(n)&&n.expression.getText(source)==='window.document.fonts.add'&&n.arguments.length===1).length,1,'Exact owned add')
 assert.ok(ts.isReturnStatement(last)&&last.expression.getText(source).replace(/\s+/g,'').endsWith('.flat().filter(Boolean)'),'Original load result shape')
 const bodyNodes=[];function inspect(n){bodyNodes.push(n);ts.forEachChild(n,inspect)}inspect(body)
 assert.equal(bodyNodes.filter(n=>ts.isNewExpression(n)&&n.expression.getText(source)===pool&&n.arguments?.length===2).length,1,'Original pool semantics')
 const bound=functions[0];assert.ok(bound.body.getText(source).startsWith('{return __designAcquireUiFontLease(document,'),'Exact immutable UI facade')
 const uiExpression=bound.body.statements[0].expression.getText(source)
 const edits=[{start:first.getStart(source),end:first.end,value:'const __designSceneLive=__designSceneGeneration(window.document,__designSceneFaces());if(!__designSceneLive())return[];'},
 {start:last.getStart(source),end:last.end,value:'const __designLoadedSceneFaces='+last.expression.getText(source)+';return __designSceneLive()?__designLoadedSceneFaces:[];'},
 {start:bound.body.getStart(source),end:bound.body.end,value:`{const ui=${uiExpression};if(document==null)return ui;let scene;try{scene=__designAcquireSceneFaces(document,__designSceneFaces(),owner)}catch(error){ui.release();throw error}return Object.freeze({ready:Promise.all([ui.ready,scene.ready]).then(results=>results.find(result=>result.status==="failed")??results.find(result=>result.status==="released")??results.find(result=>result.status==="unavailable")??Object.freeze({status:"loaded"})),release(){scene.release();ui.release()}});}`}]
 let code=result.code;for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.value+code.slice(edit.end)
 code=`import {acquireSceneFontFaces as __designAcquireSceneFaces,sceneFontGeneration as __designSceneGeneration} from ${JSON.stringify(SCENE_FONT_BROKER_SPECIFIER)};`+code+`\nfunction __designSceneFaces(){return [...${registry}.registered.values()].filter(entry=>!entry.metadata.local).flatMap(entry=>entry.fontFaces.map(wrapper=>wrapper.fontFace));}`
 assert.equal(ts.createSourceFile('managed.js',code,ts.ScriptTarget.Latest,true).parseDiagnostics.length,0)
 return {...result,code,receipt:{...result.receipt,sceneFaceRegistration:'consumer-owned exact registry objects',sceneLoadGenerationFenced:true}}
}
