// Verify default authoring and relocated/bundled execution use the approved
// policy. Inputs are read-only; only a validated temporary build is removed.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'tsdown';

const here=fileURLToPath(new URL('.',import.meta.url));
const entry=join(here,'../bundles/flow_design/scripts/layout.mjs');
const env={...process.env,NODE_PATH:'',NODE_OPTIONS:''};
for(const key of Object.keys(env))if(key.startsWith('BPMN_LAYOUT_'))delete env[key];
const root=await mkdtemp(join(tmpdir(),'flow-layout-production-'));
const run=(script,input,overrides={})=>{
  const result=spawnSync(process.execPath,[script],{input,encoding:'utf8',cwd:root,env:{...env,...overrides},timeout:60000,maxBuffer:16000000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/layoutRevision="12"/);
  const metrics=JSON.parse(result.stderr.match(/reading-metrics (\{[^\n]+\})/)[1]);
  assert.equal(metrics.preference,'balanced');assert.ok(metrics.channels);
  return result.stdout;
};
try {
  await build({config:false,entry:{layout:entry},outDir:root,format:'esm',platform:'node',target:'node22',tsconfig:false,dts:false,clean:false,
    deps:{alwaysBundle:[/.*/],onlyBundle:false},
    plugins:[{name:'no-unbundled-layout-imports',generateBundle(_options,bundle){
      for(const output of Object.values(bundle))if(output.type==='chunk')for(const name of [...output.imports,...output.dynamicImports])
        assert.ok(name.startsWith('node:')||bundle[name],`Unbundled dependency: ${name}`);
    }}]});
  for(const name of ['P-001.bpmn','P-004.bpmn','P-009.bpmn']) {
    const input=await readFile(new URL(`../../../examples/research-platform-comparison/good/design_files/flow_design/${name}`,import.meta.url),'utf8');
    const production=run(entry,input);
    assert.equal(run(entry,input,{BPMN_LAYOUT_READING:'1',BPMN_LAYOUT_PREFERENCE:'balanced',BPMN_LAYOUT_CHANNELS:'1'}),production,'default differs from approved preview');
    assert.equal(run(join(root,'layout.mjs'),input),production,'relocated packaged layout differs');
    const imported=spawnSync(process.execPath,[entry,'--validate'],{input:production,encoding:'utf8',cwd:root,env,timeout:10000});
    assert.equal(imported.status,0,imported.stderr);
    assert.equal(await readFile(new URL(`../../../examples/research-platform-comparison/good/design_files/flow_design/${name}`,import.meta.url),'utf8'),input,'source artifact changed');
    console.log(`PRODUCTION AND PORTABLE LAYOUT OK: ${name}`);
  }
} finally {await rm(root,{recursive:true,force:true});}
