import {defineConfig} from 'tsdown'
const shared={outDir:process.env.GRAPH_TEST_OUT,
  format:'esm',platform:'browser',tsconfig:false,dts:false,clean:false,
  deps:{alwaysBundle:[/.*/],onlyBundle:false},define:{'process.env.NODE_ENV':'"production"'}} as const
export default defineConfig([
  {...shared,entry:{live:new URL('./graph-live.mjs',import.meta.url).pathname}},
  {...shared,entry:{'drag-worker':new URL('./graph-drag-worker.mjs',import.meta.url).pathname}},
])
