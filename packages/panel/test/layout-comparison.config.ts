import { defineConfig } from 'tsdown'
export default defineConfig({ entry: { comparison: new URL('./layout-comparison.mjs', import.meta.url).pathname }, outDir: process.env.GRAPH_TEST_OUT,
  format:'esm',platform:'browser',tsconfig:false,dts:false,clean:false,
  deps:{alwaysBundle:[/.*/],onlyBundle:false},define:{'process.env.NODE_ENV':'"production"'} })
