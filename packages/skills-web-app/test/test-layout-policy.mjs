import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutPolicy} from '../bundles/flow_design/scripts/layout-policy.mjs';
test('production policy requires no environment or host-specific switches',()=>{
  assert.deepEqual(layoutPolicy({}),{reading:true,preference:'balanced',channels:true,boundedSearch:true,report:false});
});
test('explicit comparison settings preserve weighted and unspaced baselines',()=>{
  assert.equal(layoutPolicy({BPMN_LAYOUT_READING:'0'}).channels,false);
  assert.deepEqual(layoutPolicy({BPMN_LAYOUT_READING:'0',BPMN_LAYOUT_CHANNELS:'0',BPMN_LAYOUT_EXPERIMENT_BUDGET:'1'}),
    {reading:false,preference:'balanced',channels:false,boundedSearch:true,report:false});
  assert.equal(layoutPolicy({BPMN_LAYOUT_CHANNELS:'0'}).channels,false);
  assert.throws(()=>layoutPolicy({BPMN_LAYOUT_PREFERENCE:'typo'}),/Unknown reading preference/);
});
