import {defineConfig} from 'tsdown'
import {join} from 'node:path'
const deps=process.env.GRAPH_3D_DEPS
if(!deps)throw new Error('GRAPH_3D_DEPS must point to the isolated experimental dependency directory')
export default defineConfig({
  entry:{spatial:new URL('./graph-spatial.mjs',import.meta.url).pathname},outDir:process.env.GRAPH_TEST_OUT,
  platform:'browser',format:'esm',tsconfig:false,dts:false,clean:false,
  alias:{'spatial-orbit':join(deps,'node_modules/three/examples/jsm/controls/OrbitControls.js'),'3d-force-graph':join(deps,'node_modules/3d-force-graph/dist/3d-force-graph.mjs'),'d3-force-3d':join(deps,'node_modules/d3-force-3d/src/index.js'),three:join(deps,'node_modules/three/build/three.module.js')},
  deps:{alwaysBundle:[/.*/],onlyBundle:false},define:{'process.env.NODE_ENV':'"production"'},
})
