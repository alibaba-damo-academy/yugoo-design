/** Overlay a 3D comparison on the existing experiment. Never reads live Design Files. */
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
const [input,directory,deps,mode]=process.argv.slice(2)
assert.ok(input&&directory&&deps,'Usage: node build-graph-spatial.mjs INPUT_HTML OUTPUT_DIRECTORY ISOLATED_DEPS')
const out=resolve(directory),cwd=join(import.meta.dirname,'..')
execFileSync(process.execPath,[join(import.meta.dirname,'build-graph-live.mjs'),resolve(input),out],{stdio:'inherit'})
assert.ok(!mode||mode==='--force-only','Unknown build mode')
if(mode!=='--force-only')execFileSync(process.execPath,['--experimental-strip-types',join(import.meta.dirname,'graph-stress-build.mjs'),resolve(input),join(out,'stress-3d.json')],{stdio:'inherit'})
execFileSync('pnpm',['exec','tsdown','--config','test/graph-spatial.config.ts'],{cwd,env:{...process.env,GRAPH_TEST_OUT:out,GRAPH_3D_DEPS:resolve(deps)},stdio:'inherit'})
const html=await readFile(join(out,'comparison.html'),'utf8'),script=await readFile(join(out,'spatial.js'),'utf8'),stress=mode==='--force-only'?'null':await readFile(join(out,'stress-3d.json'),'utf8')
await writeFile(join(out,'comparison.html'),html.replace('</html>',()=>`<script id="stress-3d" type="application/json">${stress.replaceAll('<','\\u003c')}</script><script type="module">${script.replaceAll('</script','<\\/script')}</script></html>`))
console.log(join(out,'comparison.html'))
