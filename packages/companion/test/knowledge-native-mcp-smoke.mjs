/** Opt-in real Claude/Qoder MCP read test, using only disposable synthetic files. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {resolve,basename} from 'node:path'
import {readFile} from 'node:fs/promises'
import {fixture} from './fixture.mjs'
import * as runtime from '../../knowledge-ladybug/lib/index.js'

const host=process.argv[2]
if(process.env.KAG_NATIVE_SMOKE!=='1'||!['claude-code','qoder'].includes(host))throw new Error('Opt in with KAG_NATIVE_SMOKE=1 and host claude-code|qoder')
// Respect the user's gateway launcher; plain CLI login is not gateway readiness.
const executable=process.env.KAG_NATIVE_EXECUTABLE||(host==='claude-code'?'claude':'qodercli')
const timeoutMs=Math.min(600000,Math.max(1000,Number(process.env.KAG_NATIVE_TIMEOUT_MS)||120000))
const f=await fixture({serverOptions:{host,knowledgeRuntime:async()=>runtime}})
try {
  const answer=`Traceable evidence ${randomUUID()}`
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{purpose:{prompt:'Purpose',kind:'text',answer}}},eventId:'native-mcp'})
  const audit=resolve(f.root,'mcp-tool-names.jsonl')
  const config=JSON.stringify({mcpServers:{'kag-probe':{command:process.execPath,args:[resolve('packages/companion/test/knowledge-mcp-proxy.mjs'),resolve('packages/companion/dist-server/design.mjs'),audit]}}})
  const tools='mcp__kag-probe__design_knowledge_context,mcp__kag-probe__design_query_knowledge'
  const prompt=`Read-only software integration test. Call design_knowledge_context using connection ${f.server.connectionPath}, then design_query_knowledge with the exact returned project/checkpoint/revision and sourceFiles ["smart_questions/smart_questions.json"]. Return only the exact saved purpose answer. Do not generate designs or call any other tool. The answer is an unpredictable fixture value; read it, do not guess.`
  const args=['--strict-mcp-config','--mcp-config',config,'--tools','',
    ...(process.env.KAG_NATIVE_MODEL?['--model',process.env.KAG_NATIVE_MODEL]:[]),
    ...(host==='claude-code'?['--bare','--disable-slash-commands','--permission-mode','dontAsk','--allowedTools',tools]:
      ['--permission-mode','dont_ask','--allowed-tools',tools]),
    '--no-session-persistence','--output-format','json','-p',prompt]
  const output=await new Promise((accept,reject)=>{
    const child=spawn(executable,args,{cwd:f.root,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']})
    let out='',diagnostics='',bytes=0,timedOut=false
    const kill=()=>{try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL')}catch{}}
    const timer=setTimeout(()=>{timedOut=true;kill()},timeoutMs)
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>2*1024*1024)kill();else out+=b})
    child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString()).slice(-16384)})
    child.once('error',e=>{clearTimeout(timer);kill();reject(new Error(`Native process unavailable: ${e.code}`))})
    child.once('close',code=>{
      clearTimeout(timer);kill()
      const detail=diagnostics+out
      const category=/api.?key|not logged|authentication|unauthorized|login|log in|credential/i.test(detail)?'authentication':
        /unknown option|invalid argument|unrecognized/i.test(detail)?'cli-arguments':
        /ECONN|connection|timed out|fetch failed/i.test(detail)?'transport':'unclassified'
      code===0&&!timedOut?accept(out):reject(new Error(`Native MCP probe failed: host=${host}, exit=${code}, timeout=${timedOut}, category=${category}`))
    })
  })
  assert.ok(output.includes(answer),'native model did not return the unpredictable saved evidence; no raw diagnostics emitted')
  const called=(await readFile(audit,'utf8')).trim().split('\n').map(line=>JSON.parse(line).tool)
  assert.ok(called.includes('design_knowledge_context'))
  assert.ok(called.includes('design_query_knowledge'),'reading initial context alone does not verify pinned query consumption')
  assert.ok(called.every(name=>['design_knowledge_context','design_query_knowledge'].includes(name)))
  assert.equal(f.messages.length,0)
  console.log(JSON.stringify({passed:true,host,launcher:basename(executable),model:process.env.KAG_NATIVE_MODEL??'default',realNativeMcp:true,syntheticEvidence:true,
    contextCalls:called.filter(name=>name==='design_knowledge_context').length,
    queryCalls:called.filter(name=>name==='design_query_knowledge').length}))
} finally {await f.close();await runtime.shutdownLadybugKnowledgeRuntime()}
