import assert from 'node:assert/strict';
import ts from 'typescript';
import {transformMinimalFonts,hash} from './minimal-font-transform.mjs';

const PINS={prod:{index:'7f651063487849c79a8cdedc3aa6bd04c6b0c717ee63959116f1f12dbc0a51b8',metadata:'72b54e8e9b3c17c69f1dd5e40203bfaed62313bc611b86ecb8a1625a12562e51'},dev:{index:'e10e24df153077770849c7d68f9a8f5db3bb1eb1576d909d1e3c9a5b024d1882',metadata:'3cfe278cb537fde73b42bbd4697b392946517d3dc02d3f3cf8487d8476f63ba2'}};
export const pickerPrefix=`function __designFontLabel(id,alias){if(![1,2,3,5,6,7,8,9].includes(id))throw Error("Unsupported whiteboard picker font ID");const name=[3,8].includes(id)?"JetBrains Mono":"Source Han Sans CN";return [6,8].includes(id)?name:name+" ("+alias+")";}`;
function parse(text,name){const source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(source.parseDiagnostics.length,0,'JS syntax');return source}
function nodes(source,predicate){const out=[];function walk(n){if(predicate(n))out.push(n);ts.forEachChild(n,walk)}walk(source);return out}
function one(list,message){assert.equal(list.length,1,message);return list[0]}
function apply(source,text,edits){const sorted=edits.sort((a,b)=>b.start-a.start);for(let i=1;i<sorted.length;i++)assert.ok(sorted[i].end<=sorted[i-1].start,'Nonoverlapping picker edits');for(const e of sorted)text=text.slice(0,e.start)+e.value+text.slice(e.end);parse(text,'output.js');return text}
function edit(source,node,value){return{start:node.getStart(source),end:node.end,value}}
function quickOptions(source){return one(nodes(source,n=>ts.isArrayLiteralExpression(n)&&n.elements.length===3&&n.elements.every(ts.isObjectLiteralExpression)&&n.elements[0].properties.some(p=>p.name?.getText(source)==='testId'&&p.initializer?.text==='font-family-hand-drawn')),'Actual quick font array')}
function defaultNode(source,mode){const name=mode==='prod'?'Ft':'DEFAULT_FONT_FAMILY';return one(nodes(source,n=>ts.isVariableDeclaration(n)&&n.name.getText(source)===name&&n.initializer?.getText(source)===(mode==='prod'?'Ie':'FONT_FAMILY')+'.Excalifont'),'Actual new-scene default')}
function transformIndex(indexCode,mode){
 const source=parse(indexCode,'index.js'),edits=[],quick=quickOptions(source);
 const selected=quick.elements.slice(1).map((node,i)=>{let text=node.getText(source);const p=one(node.properties.filter(p=>p.name?.getText(source)==='text'),'Quick label');const start=p.initializer.getStart(source)-node.getStart(source),end=p.initializer.end-node.getStart(source);return text.slice(0,start)+JSON.stringify(i===0?'Source Han Sans CN':'JetBrains Mono')+text.slice(end)});
 edits.push(edit(source,quick,'['+selected.join(',')+']'));
 const label=one(nodes(source,n=>ts.isPropertyAssignment(n)&&n.name.getText(source)==='text'&&n.initializer.getText(source).includes('fontFace')&&n.initializer.getText(source).includes('family')&&n.initializer.getText(source).includes('"Unknown"')),'Actual expanded font label');
 let map=label.parent;while(map&&!ts.isArrowFunction(map))map=map.parent;
 assert.ok(map&&ts.isArrayBindingPattern(map.parameters[0].name),'Registry map destructuring');const id=map.parameters[0].name.elements[0].name.getText(source);
 edits.push(edit(source,label.initializer,`__designFontLabel(${id},${label.initializer.getText(source)})`));
 const available=one(nodes(source,n=>ts.isArrowFunction(n)&&n.body.getText(source).includes('.deprecated')&&n.body.getText(source).includes('.value')&&n.body.getText(source).includes('.has(')&&ts.isCallExpression(n.parent)&&n.parent.expression.getText(source).endsWith('.filter')),'Actual available-font predicate');
 const parameter=available.parameters[0].name.getText(source);
 const has=one(nodes(available.body,n=>ts.isCallExpression(n)&&n.expression.getText(source).endsWith('.has')),'Scene family membership');
 edits.push(edit(source,available.body,`!${has.getText(source)}&&[6,8].includes(${parameter}.value)`));
 // Keep scene fonts in their existing group; only unused available choices are constrained.
 const output=pickerPrefix+apply(source,indexCode,edits);
 return {code:output,receipt:{mode,quickChoices:[6,8],availableChoices:[6,8],labels:['Source Han Sans CN','JetBrains Mono'],indexSemanticEdits:edits.length,sceneNumericIdsUnchanged:true,deprecatedToggleCannotRevealUnusedLegacyFonts:true}};
}
export function transformPickerSource({indexCode,metadataCode,mode='prod'}){
 assert.ok(PINS[mode],'Supported renderer mode');assert.equal(hash(indexCode),PINS[mode].index,'Exact picker index guard');assert.equal(hash(metadataCode),PINS[mode].metadata,'Exact picker metadata guard');
 const index=transformIndex(indexCode,mode),source=parse(metadataCode,'metadata.js'),node=defaultNode(source,mode);
 const metadata=apply(source,metadataCode,[edit(source,node.initializer,(mode==='prod'?'Ie':'FONT_FAMILY')+'.Nunito')]);
 return {indexCode:index.code,metadataCode:metadata,receipt:{...index.receipt,newSceneDefault:6,metadataDefaultEdits:1,devFontReplacementIntegrated:false}};
}
export function transformMinimalWithPicker(input,indexCode){
 const mode=input.mode??'prod';
 // Original source pins are checked before calling the retained synchronous-recovery transform.
 const picker=transformPickerSource({indexCode,metadataCode:input.code,mode}),base=transformMinimalFonts(input),source=parse(base.code,'replacement.js'),node=defaultNode(source,mode);
 const code=apply(source,base.code,[edit(source,node.initializer,(mode==='prod'?'Ie':'FONT_FAMILY')+'.Nunito')]);
 return {...base,code,indexCode:picker.indexCode,receipt:{...base.receipt,picker:picker.receipt,baseSyncRecoveryPreserved:true}};
}
