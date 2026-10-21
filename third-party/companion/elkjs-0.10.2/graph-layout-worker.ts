import { build } from 'tsdown'

/** Inline a self-contained Worker so both DSH's factory loader and Companion
 * can load it without a CDN, repository path or host-specific asset route. */
export function graphLayoutWorker() {
  let compiled: Promise<string> | undefined
  return {
    name: 'design-graph-layout-worker',
    resolveId(id: string) { if (id === 'design-graph-layout-worker-source') return '\0design-graph-layout-worker-source' },
    async load(id: string) {
      if (id !== '\0design-graph-layout-worker-source') return null
      compiled ??= (async () => {
        const result = await build({ config: false, entry: new URL('../packages/panel/src/client/graph-layout-worker.mjs', import.meta.url).pathname,
          write: false, format: 'iife', platform: 'browser', tsconfig: false, dts: false, clean: false,
          plugins: [{ name: 'elk-nested-worker-shim', transform(code, id) {
            // ELK's UMD worker detects self + no document and installs its own
            // onmessage rather than exporting its in-process shim. Inside our
            // owned Worker it must export that shim; only this module sees the
            // lexical sentinel, never the actual Worker global or host DOM.
            if (id.endsWith('/elk.bundled.js')) return { code: 'var document = {};\n' + code, map: null }
          } }],
          minify: true, deps: { alwaysBundle: [/.*/], onlyBundle: false }, logLevel: 'error',
          define: { 'process.env.NODE_ENV': '"production"' } })
        try {
          const chunks = result.flatMap(bundle => bundle.chunks)
          if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) throw new Error('Layout Worker must be one self-contained script')
          return `export default ${JSON.stringify(chunks[0].code)}`
        } finally { for (const bundle of result) await bundle[Symbol.asyncDispose]() }
      })()
      return compiled
    },
  }
}
