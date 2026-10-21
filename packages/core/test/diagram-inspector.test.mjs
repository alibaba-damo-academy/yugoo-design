import test from 'node:test'
import assert from 'node:assert/strict'
import {validatePanelManifest} from '../src/panel-dsl.ts'
const panel=()=>({version:1,panel_kind:'process',sections:[
 {id:'flows',title:'Flows',records_path:'flows.records'},
 {id:'flowDetails',title:'Details',records_path:'flows.records',fields_path:'details'},
 {id:'steps',title:'Steps',records_path:'steps.records'},
 {id:'rules',title:'Rules',records_path:'rules.records'},
],fields:[
 {key:'title',control:'text',applies_to:['flows','steps']},
 {key:'file',control:'artifact_ref',applies_to:['flowDetails']},
 {key:'flow',control:'record_select',options_from_section:'flows',applies_to:['steps','rules']},
 {key:'element',control:'text',applies_to:['steps']},
 {key:'step',control:'record_select',options_from_section:'steps',applies_to:['rules']},
],ui:{component:'diagram_workspace',id:'flow',source:'flowDetails',diagram:{format:'bpmn',file_field:'file',label_source:'flows',label_field:'title',artifact_kind:'flow_bpmn',inspector:{process_sections:['flows','flowDetails'],nodes:{source:'steps',process_field:'flow',element_field:'element',label_field:'title',sections:['steps']},related:[{source:'rules',process_field:'flow',node_field:'step',sections:['rules']}]}}}})
test('diagram inspector keeps process labels and record editors on their declared canonical collections',()=>assert.deepEqual(validatePanelManifest(panel()),[]))
test('invalid inspector references cannot expose unrelated record collections',()=>{
 for(const change of [
 p=>p.ui.diagram.label_source='steps',
 p=>p.ui.diagram.inspector.process_sections=['rules'],
 p=>p.ui.diagram.inspector.nodes.sections=['rules'],
 p=>p.fields.find(f=>f.key==='flow').options_from_section='steps',
 p=>p.fields.find(f=>f.key==='step').options_from_section='flows',
 p=>p.ui.diagram.inspector.nodes.element_field='__proto__',
 p=>p.ui.diagram.inspector.related={},
 p=>p.ui.diagram.inspector=null,
 ]){const p=panel();change(p);assert.ok(validatePanelManifest(p).length,String(change))}
})
